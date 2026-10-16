// E5 writes and reads: financial statement lines (`financials`), stored ratios (`stock_ratios`) and the inputs the
// `ratios` job needs (latest closes, listed shares, JISDOR, Yahoo dividends and their coverage).
import { and, asc, desc, eq, gt, inArray, lte, max, sql } from "drizzle-orm";
import * as t from "../../db/schema";
import type { FinancialFact, RatioKey } from "../derive/ratios";
import type { FundamentalPoint } from "../sources/yahoo-fundamentals";
import type { EngineDb } from "./client";
import type { Provenance } from "./ingest";

const CHUNK = 500;
function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
const ex = (column: string) => sql.raw(`excluded."${column}"`);

// ── financials ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Upserts one symbol's statement lines from one document. A later document replaces a period's value (restatements)
 * and its provenance; periods the source no longer returns are kept (Yahoo's window slides forward).
 */
export async function upsertFinancials(db: EngineDb, symbol: string, points: FundamentalPoint[], prov: Provenance): Promise<number> {
  for (const batch of chunks(points)) {
    await db.insert(t.financials).values(batch.map((point) => ({
      symbol, periodEnd: point.periodEnd, periodType: point.periodType, metric: point.metric, value: point.value, unit: point.unit,
      currency: point.currency, source: prov.source, asOf: prov.asOf, rawRef: prov.rawRef,
    }))).onConflictDoUpdate({
      target: [t.financials.symbol, t.financials.periodEnd, t.financials.periodType, t.financials.metric, t.financials.source],
      set: { value: ex("value"), unit: ex("unit"), currency: ex("currency"), asOf: ex("as_of"), rawRef: ex("raw_ref") },
    });
  }
  return points.length;
}

export type FinancialRecord = {
  periodEnd: string; periodType: "annual" | "quarterly"; metric: string; value: number; unit: "amount" | "per_share" | "shares";
  currency: string | null; source: string; asOf: Date;
};

/** Every stored line of a symbol, newest period first. */
export async function financialsOf(db: EngineDb, symbol: string): Promise<FinancialRecord[]> {
  return db.select({
    periodEnd: t.financials.periodEnd, periodType: t.financials.periodType, metric: t.financials.metric, value: t.financials.value,
    unit: t.financials.unit, currency: t.financials.currency, source: t.financials.source, asOf: t.financials.asOf,
  }).from(t.financials).where(eq(t.financials.symbol, symbol))
    .orderBy(desc(t.financials.periodEnd), asc(t.financials.periodType), asc(t.financials.metric));
}

/** Lines of `metrics` for `symbols`, grouped by symbol (the ratio job's input). */
export async function financialFacts(db: EngineDb, symbols: string[], metrics: string[], source: string): Promise<Map<string, FinancialFact[]>> {
  const out = new Map<string, FinancialFact[]>();
  if (!symbols.length) return out;
  const rows = await db.select({
    symbol: t.financials.symbol, periodEnd: t.financials.periodEnd, periodType: t.financials.periodType, metric: t.financials.metric,
    value: t.financials.value, currency: t.financials.currency, asOf: t.financials.asOf, rawRef: t.financials.rawRef, source: t.financials.source,
  }).from(t.financials).where(and(inArray(t.financials.symbol, symbols), inArray(t.financials.metric, metrics), eq(t.financials.source, source)));
  for (const { symbol, ...fact } of rows) {
    if (!out.has(symbol)) out.set(symbol, []);
    out.get(symbol)!.push(fact);
  }
  return out;
}

/** Symbols with any stored line from `source`, alphabetically. */
export async function symbolsWithFinancials(db: EngineDb, source: string): Promise<string[]> {
  const rows = await db.selectDistinct({ symbol: t.financials.symbol }).from(t.financials).where(eq(t.financials.source, source)).orderBy(asc(t.financials.symbol));
  return rows.map((row) => row.symbol);
}

/** Newest quarterly period end per symbol (the earnings-season catch-up compares it with the expected quarter). */
export async function latestQuarterEnds(db: EngineDb, source: string): Promise<Map<string, string>> {
  const rows = await db.select({ symbol: t.financials.symbol, end: max(t.financials.periodEnd) }).from(t.financials)
    .where(and(eq(t.financials.source, source), eq(t.financials.periodType, "quarterly"))).groupBy(t.financials.symbol);
  return new Map(rows.filter((row) => row.end).map((row) => [row.symbol, row.end!]));
}

// ── stock_ratios ────────────────────────────────────────────────────────────────────────────────────────────────

export type RatioUpsert = {
  symbol: string; ratio: RatioKey; value: number | null; date: string; basis: string; note: string | null;
  inputs: Record<string, string | number | null>; derivation: string | null; source: string; asOf: Date; rawRef: string | null;
};

export async function upsertRatios(db: EngineDb, ratioSource: (typeof t.RATIO_SOURCES)[number], rows: RatioUpsert[], computedAt: Date): Promise<number> {
  for (const batch of chunks(rows)) {
    await db.insert(t.stockRatios).values(batch.map((row) => ({ ...row, ratioSource, computedAt }))).onConflictDoUpdate({
      target: [t.stockRatios.symbol, t.stockRatios.ratio, t.stockRatios.ratioSource],
      set: {
        value: ex("value"), date: ex("date"), basis: ex("basis"), note: ex("note"), inputs: ex("inputs"), derivation: ex("derivation"),
        computedAt: ex("computed_at"), source: ex("source"), asOf: ex("as_of"), rawRef: ex("raw_ref"),
      },
    });
  }
  return rows.length;
}

/** Removes stored ratios of one source for (symbol, ratio) pairs whose inputs are now missing. */
export async function deleteRatios(db: EngineDb, ratioSource: (typeof t.RATIO_SOURCES)[number], pairs: Array<{ symbol: string; ratio: RatioKey }>): Promise<number> {
  let deleted = 0;
  for (const batch of chunks(pairs)) {
    const keys = sql.join(batch.map((pair) => sql`(${pair.symbol}, ${pair.ratio})`), sql`, `);
    const rows = await db.delete(t.stockRatios)
      .where(and(eq(t.stockRatios.ratioSource, ratioSource), sql`(${t.stockRatios.symbol}, ${t.stockRatios.ratio}) in (${keys})`))
      .returning({ symbol: t.stockRatios.symbol });
    deleted += rows.length;
  }
  return deleted;
}

export type StoredRatio = { symbol: string; ratio: RatioKey; ratioSource: (typeof t.RATIO_SOURCES)[number]; value: number | null; date: string };

export async function storedRatios(db: EngineDb): Promise<StoredRatio[]> {
  return db.select({ symbol: t.stockRatios.symbol, ratio: t.stockRatios.ratio, ratioSource: t.stockRatios.ratioSource, value: t.stockRatios.value, date: t.stockRatios.date })
    .from(t.stockRatios);
}

// ── ratio job inputs ────────────────────────────────────────────────────────────────────────────────────────────

/** Each symbol's newest close at or before `date`, with its session date. */
export async function closesAtOrBefore(db: EngineDb, date: string, symbols: string[]): Promise<Map<string, { close: number; date: string }>> {
  if (!symbols.length) return new Map();
  const rows = await db.selectDistinctOn([t.dailyPrices.symbol], { symbol: t.dailyPrices.symbol, close: t.dailyPrices.close, date: t.dailyPrices.date })
    .from(t.dailyPrices).where(and(inArray(t.dailyPrices.symbol, symbols), lte(t.dailyPrices.date, date)))
    .orderBy(t.dailyPrices.symbol, desc(t.dailyPrices.date));
  return new Map(rows.map((row) => [row.symbol, { close: row.close, date: row.date }]));
}

export async function listedShares(db: EngineDb, symbols: string[]): Promise<Map<string, number>> {
  if (!symbols.length) return new Map();
  const rows = await db.select({ symbol: t.securities.symbol, shares: t.securities.sharesOutstanding }).from(t.securities).where(inArray(t.securities.symbol, symbols));
  return new Map(rows.filter((row) => row.shares !== null && row.shares > 0).map((row) => [row.symbol, row.shares!]));
}

/** JISDOR (IDR per USD) observations, oldest first. */
export async function jisdorSeries(db: EngineDb): Promise<Array<{ date: string; value: number }>> {
  return db.select({ date: t.macroObservations.date, value: t.macroObservations.value }).from(t.macroObservations)
    .where(eq(t.macroObservations.series, "JISDOR")).orderBy(asc(t.macroObservations.date));
}

/** Cash dividends (per share) with an ex-date after `from` from `source` (Yahoo chart events). */
export async function dividendsSince(db: EngineDb, from: string, symbols: string[], source: string): Promise<Map<string, Array<{ exDate: string; amount: number }>>> {
  const out = new Map<string, Array<{ exDate: string; amount: number }>>();
  if (!symbols.length) return out;
  const rows = await db.select({ symbol: t.corporateActions.symbol, exDate: t.corporateActions.exDate, amount: t.corporateActions.amount }).from(t.corporateActions)
    .where(and(inArray(t.corporateActions.symbol, symbols), eq(t.corporateActions.type, "DIVIDEND"), eq(t.corporateActions.source, source), gt(t.corporateActions.exDate, from)));
  for (const row of rows) {
    if (!row.exDate || row.amount === null) continue;
    if (!out.has(row.symbol)) out.set(row.symbol, []);
    out.get(row.symbol)!.push({ exDate: row.exDate, amount: row.amount });
  }
  return out;
}

/**
 * Symbols whose `source` price history reaches back to `date` (the backfill has run for them, so that source's
 * dividend events for the window are stored and an empty window is a real zero).
 */
export async function historyCoveredSince(db: EngineDb, date: string, symbols: string[], source: string): Promise<Set<string>> {
  if (!symbols.length) return new Set();
  const rows = await db.selectDistinct({ symbol: t.dailyPrices.symbol }).from(t.dailyPrices)
    .where(and(inArray(t.dailyPrices.symbol, symbols), eq(t.dailyPrices.source, source), lte(t.dailyPrices.date, date)));
  return new Set(rows.map((row) => row.symbol));
}
