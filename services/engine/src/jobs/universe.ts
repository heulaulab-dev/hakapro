// Universe + session values after the close (§5.11 items 1–2): one TradingView `indonesia/scan` for the whole market
// and a paginated Pasardana GetAll pass. Either source can carry the run when the other is BLOCKED.
//   securities: upsert (board/notation stay unknown = null), `active` from the union of both lists.
//   daily_prices: TradingView's final session row and Pasardana's previous-session row are fallback rows: they fill
//   value (and frequency) and insert rows Yahoo has not written, but never overwrite Yahoo's OHLCV.
//   stock_ratios: Pasardana's own PER/PBV/ROE as the `pasardana` ratio source (E5; no extra request), dated by
//   its LastDate. The screener uses them only where no derived ratio exists.
import { deleteRatios, upsertRatios, type RatioUpsert } from "../db/fundamentals";
import type { Provenance } from "../db/ingest";
import type { RatioKey } from "../derive/ratios";
import { activeSymbols, deactivateMissing, upsertDaily, upsertSecurities, type DailyUpsert } from "../db/ingest";
import { SourceBlockedError } from "../fetch/fetcher";
import type { JobDefinition } from "../schedule/scheduler";
import { getAllUrl, parseGetAll, PASARDANA_MAX_PAGES, PASARDANA_PAGE_SIZE, type PasardanaRow } from "../sources/pasardana";
import { sessionFinal, wibToday } from "../sources/session";
import { impliedPreviousClose, MARKET_PAGE_SIZE, MARKET_SCAN_URL, marketScanBody, parseMarketScan, type TvStockRow } from "../sources/tradingview";
import { fetchFor, parseDocument, provenanceOf, withSource, type JobServices, type SourceRef } from "./common";

/** 16:35 WIB on trading days: TradingView's 10-minute delay has passed the 16:15 close. */
export const UNIVERSE_CRON = "35 16 * * *";
/** Default delay when a row does not state one (TradingView's IDX feed is delayed 600 s). */
export const DEFAULT_TV_DELAY_SECONDS = 600;
const MAX_SCAN_PAGES = 3;

/** Whole-market scan, all pages. Returns rows and the provenance of each page. */
export async function scanMarket(services: JobServices, ctx: Parameters<JobDefinition["run"]>[0], source: SourceRef) {
  const pages: Array<{ rows: TvStockRow[]; result: Awaited<ReturnType<typeof fetchFor>> }> = [];
  let total = Infinity;
  for (let page = 0, from = 0; page < MAX_SCAN_PAGES && from < total; page += 1, from += MARKET_PAGE_SIZE) {
    const body = marketScanBody(from, from + MARKET_PAGE_SIZE);
    const result = await fetchFor(services, ctx, source, MARKET_SCAN_URL, { method: "POST", body, headers: { "content-type": "application/json" } });
    const parsed = await parseDocument(services, result, parseMarketScan);
    total = parsed.totalCount;
    pages.push({ rows: parsed.rows, result });
    if (parsed.skipped) services.log.info("tradingview_rows_skipped", { job: ctx.jobId, skipped: parsed.skipped });
    if (parsed.rows.length + parsed.skipped < MARKET_PAGE_SIZE) break;
  }
  return pages;
}

/** Seconds TradingView's rows lag the wall clock (most common stated delay). */
export function scanDelaySeconds(rows: Array<{ delaySeconds: number | null }>): number {
  const counts = new Map<number, number>();
  for (const row of rows) if (row.delaySeconds !== null) counts.set(row.delaySeconds, (counts.get(row.delaySeconds) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DEFAULT_TV_DELAY_SECONDS;
}

export function tvDailyRows(rows: TvStockRow[], date: string): DailyUpsert[] {
  return rows.filter((row) => row.close !== null).map((row) => ({
    symbol: row.symbol, date, open: row.open, high: row.high, low: row.low, close: row.close!,
    previousClose: impliedPreviousClose(row.close, row.changePercent), volume: row.volume === null ? null : Math.round(row.volume),
    value: row.value === null ? null : Math.round(row.value),
  }));
}

/**
 * Pasardana's published ratios as `pasardana` stock_ratios rows. PER and PBV of zero or below (losses, negative
 * equity) are stored as null with a note, matching the derived rule; a ratio Pasardana leaves empty is removed.
 */
export function pasardanaRatioRows(rows: PasardanaRow[], prov: Provenance): { upserts: RatioUpsert[]; removed: Array<{ symbol: string; ratio: RatioKey }> } {
  const upserts: RatioUpsert[] = [];
  const removed: Array<{ symbol: string; ratio: RatioKey }> = [];
  const fields: Array<{ ratio: RatioKey; field: string; positive: boolean }> = [
    { ratio: "per", field: "Per", positive: true }, { ratio: "pbv", field: "Pbr", positive: true }, { ratio: "roe", field: "Roe", positive: false },
  ];
  for (const row of rows) {
    if (!row.date) continue;
    for (const { ratio, field, positive } of fields) {
      const value = row.ratios[ratio as keyof PasardanaRow["ratios"]];
      if (value === null) { removed.push({ symbol: row.symbol, ratio }); continue; }
      const meaningful = !positive || value > 0;
      upserts.push({
        symbol: row.symbol, ratio, value: meaningful ? value : null, date: row.date, basis: `pasardana:${field}`,
        note: meaningful ? null : "NON_POSITIVE_SOURCE_VALUE", inputs: { [field]: value }, derivation: null,
        source: prov.source, asOf: prov.asOf, rawRef: prov.rawRef,
      });
    }
  }
  return { upserts, removed };
}

export function pasardanaDailyRows(rows: PasardanaRow[]): DailyUpsert[] {
  return rows.filter((row) => row.date && row.close !== null).map((row) => ({
    symbol: row.symbol, date: row.date!, open: row.open, high: row.high, low: row.low, close: row.close!, previousClose: row.previousClose,
    volume: row.volume, value: row.value, frequency: row.frequency,
  }));
}

export function universeJob(services: JobServices, sources: { tradingview: SourceRef; pasardana: SourceRef }): JobDefinition {
  return {
    id: "universe",
    trigger: { kind: "cron", spec: UNIVERSE_CRON, tradingDaysOnly: true },
    async run(ctx) {
      const now = services.now();
      const tv = await withSource(services, ctx, sources.tradingview.id, async () => {
        const pages = await scanMarket(services, ctx, sources.tradingview);
        const rows = pages.flatMap((page) => page.rows);
        let written = 0;
        // TradingView's rows lag by their stated delay; only a session whose close is past that delay is final.
        const dataTime = new Date(now.getTime() - scanDelaySeconds(rows) * 1000);
        const final = sessionFinal(dataTime) && wibToday(dataTime) === wibToday(now);
        for (const page of pages) {
          const prov = provenanceOf(page.result);
          written += await upsertSecurities(services.db, page.rows.map((row) => ({ symbol: row.symbol, name: row.name, sector: row.sector, marketCap: row.marketCap === null ? null : Math.round(row.marketCap) })), prov);
          if (final) written += await upsertDaily(services.db, tvDailyRows(page.rows, wibToday(now)), prov, { primary: false, value: "fill" });
        }
        return { value: { symbols: rows.map((row) => row.symbol), final }, rows: written };
      });

      if (ctx.shouldYield()) return { status: "YIELDED" };
      const pasardana = await withSource(services, ctx, sources.pasardana.id, async () => {
        const symbols: string[] = [];
        let written = 0;
        for (let page = 1; page <= PASARDANA_MAX_PAGES; page += 1) {
          const result = await fetchFor(services, ctx, sources.pasardana, getAllUrl(page));
          const parsed = await parseDocument(services, result, parseGetAll);
          const prov = provenanceOf(result);
          written += await upsertSecurities(services.db, parsed.rows.map((row) => ({
            symbol: row.symbol, name: row.name, sector: row.sector, subsector: row.subsector, industry: row.industry,
            sharesOutstanding: row.sharesOutstanding, marketCap: row.marketCap, freeFloatPct: row.freeFloatPct,
          })), prov);
          // Pasardana's value and frequency are the session's official totals: they replace TradingView's value.
          written += await upsertDaily(services.db, pasardanaDailyRows(parsed.rows), prov, { primary: false, value: "overwrite" });
          const ratios = pasardanaRatioRows(parsed.rows, prov);
          written += await upsertRatios(services.db, "pasardana", ratios.upserts, now);
          if (ratios.removed.length) await deleteRatios(services.db, "pasardana", ratios.removed);
          symbols.push(...parsed.rows.map((row) => row.symbol));
          if (parsed.received < PASARDANA_PAGE_SIZE || ctx.shouldYield()) break;
        }
        return { value: { symbols }, rows: written };
      });

      if (!tv.ok && !pasardana.ok) throw new SourceBlockedError(sources.tradingview.id, null);
      // Deactivate only when both lists are complete; a single list may lag a new listing or a delisting.
      if (tv.ok && pasardana.ok && tv.value.symbols.length && pasardana.value.symbols.length) {
        const known = await activeSymbols(services.db);
        const seen = [...new Set([...tv.value.symbols, ...pasardana.value.symbols])];
        // Sanity guard: a truncated response must not deactivate most of the market.
        if (seen.length >= known.length * 0.9) {
          const deactivated = await deactivateMissing(services.db, seen);
          if (deactivated) services.log.info("securities_deactivated", { count: deactivated });
        }
      }
    },
  };
}
