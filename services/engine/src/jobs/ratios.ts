// Derived valuation ratios (E5): no network. For every symbol with stored statement lines, combines them with the
// symbol's newest close (at or before the newest session), listed shares, JISDOR (USD filers) and Yahoo dividend
// events, and stores the results as `derived` rows in stock_ratios (formulas: src/derive/ratios.ts). Ratios whose
// inputs are missing are removed, so the screener falls back to Pasardana's own ratio for them.
// Runs at 06:15 (after the night's fundamentals batches), 17:15 (after the first EOD run) and 21:15 (after the last).
import { max } from "drizzle-orm";
import * as t from "../../db/schema";
import {
  closesAtOrBefore, deleteRatios, dividendsSince, financialFacts, historyCoveredSince, jisdorSeries, listedShares, symbolsWithFinancials, upsertRatios, type RatioUpsert,
} from "../db/fundamentals";
import { deriveRatios, DERIVATION_VERSION, DIVIDEND_WINDOW_DAYS, type FinancialFact, type RatioKey } from "../derive/ratios";
import type { JobDefinition } from "../schedule/scheduler";
import { addDays } from "../sources/session";
import type { JobServices } from "./common";

export const RATIOS_CRON = "15 6,17,21 * * *";
/** Statement lines the formulas read. */
export const RATIO_METRICS = ["netIncome", "netIncomeCommon", "equity", "totalEquity", "totalLiabilities", "totalAssets", "sharesOutstanding", "dividendsPaid", "commonDividendsPaid"];
const CHUNK = 200;

/** IDR per unit of currency on or before `date`: 1 for IDR, the newest JISDOR for USD, otherwise unknown. */
export function fxLookup(jisdor: Array<{ date: string; value: number }>, date: string) {
  return (currency: string) => {
    if (currency === "IDR") return { rate: 1, date: null };
    if (currency !== "USD") return null;
    const row = [...jisdor].reverse().find((observation) => observation.date <= date);
    return row ? { rate: row.value, date: row.date } : null;
  };
}

/** Newest-fetched statement row among `facts` (the derived row's provenance). */
function newestFact(facts: FinancialFact[]): FinancialFact | null {
  return facts.reduce<FinancialFact | null>((best, fact) => (!best || (fact.asOf && best.asOf && fact.asOf > best.asOf) ? fact : best), null);
}

export function ratiosJob(services: JobServices, sources: { fundamentals: string; chart: string }): JobDefinition {
  return {
    id: "ratios",
    trigger: { kind: "cron", spec: RATIOS_CRON },
    async run(ctx) {
      const [{ session } = { session: null }] = await services.db.select({ session: max(t.dailyPrices.date) }).from(t.dailyPrices);
      if (!session) return { status: "SUCCEEDED" };
      const computedAt = services.now();
      const jisdor = await jisdorSeries(services.db);
      const symbols = await symbolsWithFinancials(services.db, sources.fundamentals);
      const windowStart = addDays(session, -DIVIDEND_WINDOW_DAYS);
      for (let i = 0; i < symbols.length; i += CHUNK) {
        if (ctx.shouldYield()) return { status: "YIELDED" };
        const chunk = symbols.slice(i, i + CHUNK);
        const [facts, closes, shares, dividends, covered] = await Promise.all([
          financialFacts(services.db, chunk, RATIO_METRICS, sources.fundamentals),
          closesAtOrBefore(services.db, session, chunk),
          listedShares(services.db, chunk),
          dividendsSince(services.db, addDays(windowStart, -7), chunk, sources.chart),
          historyCoveredSince(services.db, windowStart, chunk, sources.chart),
        ]);
        const upserts: RatioUpsert[] = [];
        const removed: Array<{ symbol: string; ratio: RatioKey }> = [];
        for (const symbol of chunk) {
          const close = closes.get(symbol) ?? null;
          const priceDate = close?.date ?? session;
          const results = deriveRatios({
            priceDate, price: close?.close ?? null, shares: shares.get(symbol) ?? null, facts: facts.get(symbol) ?? [],
            fx: fxLookup(jisdor, priceDate), dividends: covered.has(symbol) ? dividends.get(symbol) ?? [] : null,
          });
          for (const result of results) {
            if (result.status === "missing") { removed.push({ symbol, ratio: result.ratio }); continue; }
            const provenance = newestFact(result.facts);
            upserts.push({
              symbol, ratio: result.ratio, value: result.value, date: priceDate, basis: result.basis, note: result.note,
              inputs: { ...result.inputs, priceSource: close ? "daily_prices" : null }, derivation: DERIVATION_VERSION,
              // Dividend yield from price-history events rests on the chart source, not on a statement row.
              source: provenance?.source ?? sources.chart, asOf: provenance?.asOf ?? computedAt, rawRef: provenance?.rawRef ?? null,
            });
          }
        }
        ctx.report.rows(await upsertRatios(services.db, "derived", upserts, computedAt));
        if (removed.length) await deleteRatios(services.db, "derived", removed);
      }
      return { status: "SUCCEEDED" };
    },
  };
}
