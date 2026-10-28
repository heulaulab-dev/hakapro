// Idempotent writes for the E2/E2b sources. Every row carries `source`, `as_of` and `raw_ref`.
// Precedence on daily_prices / index_daily: a primary source (Yahoo for stocks, TradingView for indices) always
// writes its OHLC; a fallback source inserts missing rows and refreshes only rows it wrote itself.
import { and, asc, eq, inArray, notInArray, sql, type SQL } from "drizzle-orm";
import * as t from "../../db/schema";
import type { EngineDb } from "./client";

export type Provenance = { source: string; asOf: Date; rawRef: string | null };

const CHUNK = 500;
function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

const cur = (table: string, column: string) => sql.raw(`"${table}"."${column}"`);
const ex = (column: string) => sql.raw(`excluded."${column}"`);
/** `excluded.col` when the existing row came from the same source (or `always`), else the existing value. */
const ownOrKeep = (table: string, column: string, always: boolean): SQL =>
  always ? ex(column) : sql`case when ${cur(table, "source")} = excluded."source" then ${ex(column)} else ${cur(table, column)} end`;

// ── securities ──────────────────────────────────────────────────────────────────────────────────────────────────

export type SecurityUpsert = {
  symbol: string; name: string | null; board?: string | null; listingDate?: string | null; sector?: string | null; subsector?: string | null; industry?: string | null;
  sharesOutstanding?: number | null; marketCap?: number | null; freeFloatPct?: number | null;
};

/** Upserts the universe. Known values are never replaced by nulls; board/notation/listing date are left alone (unknown). */
export async function upsertSecurities(db: EngineDb, rows: SecurityUpsert[], prov: Provenance): Promise<number> {
  const keep = (column: string) => sql`coalesce(${ex(column)}, ${cur("securities", column)})`;
  for (const batch of chunks(rows)) {
    await db.insert(t.securities).values(batch.map((row) => ({
      symbol: row.symbol, name: row.name ?? row.symbol, board: row.board ?? null, listingDate: row.listingDate ?? null,
      sector: row.sector ?? null, subsector: row.subsector ?? null, industry: row.industry ?? null,
      sharesOutstanding: row.sharesOutstanding ?? null, marketCap: row.marketCap ?? null, freeFloatPct: row.freeFloatPct ?? null,
      active: true, source: prov.source, asOf: prov.asOf, rawRef: prov.rawRef,
    }))).onConflictDoUpdate({
      target: t.securities.symbol,
      set: {
        // A source without a real name (symbol placeholder) never overwrites one.
        name: sql`case when ${ex("name")} = ${ex("symbol")} then ${cur("securities", "name")} else ${ex("name")} end`,
        sector: keep("sector"), subsector: keep("subsector"), industry: keep("industry"), board: keep("board"), listingDate: keep("listing_date"),
        sharesOutstanding: keep("shares_outstanding"), marketCap: keep("market_cap"), freeFloatPct: keep("free_float_pct"),
        active: sql`true`, source: ex("source"), asOf: ex("as_of"), rawRef: ex("raw_ref"), updatedAt: sql`now()`,
      },
    });
  }
  return rows.length;
}

/** Marks securities missing from a complete universe pass inactive; returns how many changed. */
export async function deactivateMissing(db: EngineDb, seen: string[]): Promise<number> {
  if (!seen.length) return 0;
  const rows = await db.update(t.securities).set({ active: false, updatedAt: new Date() })
    .where(and(eq(t.securities.active, true), notInArray(t.securities.symbol, seen))).returning({ symbol: t.securities.symbol });
  return rows.length;
}

export async function activeSymbols(db: EngineDb): Promise<string[]> {
  const rows = await db.select({ symbol: t.securities.symbol }).from(t.securities).where(eq(t.securities.active, true)).orderBy(asc(t.securities.symbol));
  return rows.map((row) => row.symbol);
}

// ── daily_prices ────────────────────────────────────────────────────────────────────────────────────────────────

export type DailyUpsert = {
  symbol: string; date: string; open: number | null; high: number | null; low: number | null; close: number;
  previousClose: number | null; volume: number | null; adjClose?: number | null;
  value?: number | null; frequency?: number | null;
  foreignBuy?: number | null; foreignSell?: number | null;
};

export type DailyPolicy = {
  /** Primary OHLC source: always writes OHLC. Otherwise OHLC is written only on insert or over its own rows. */
  primary: boolean;
  /** overwrite: value/frequency replace existing ones · fill: only where missing · none: untouched. */
  value: "overwrite" | "fill" | "none";
  /** Write foreign buy/sell (with their own provenance) from these rows. */
  foreign?: boolean;
};

export async function upsertDaily(db: EngineDb, rows: DailyUpsert[], prov: Provenance, policy: DailyPolicy): Promise<number> {
  const table = "daily_prices";
  const ohlc = (column: string) => ownOrKeep(table, column, policy.primary);
  const valueSet = (column: string): SQL | undefined => {
    if (policy.value === "none") return undefined;
    return policy.value === "overwrite" ? sql`coalesce(${ex(column)}, ${cur(table, column)})` : sql`coalesce(${cur(table, column)}, ${ex(column)})`;
  };
  // value_source follows whichever source supplied the value now stored.
  const valueProvenance = (column: string): SQL | undefined => {
    if (policy.value === "none") return undefined;
    const ours = policy.value === "overwrite" ? sql`excluded."value" is not null` : sql`${cur(table, "value")} is null and excluded."value" is not null`;
    return sql`case when ${ours} then ${ex(column)} else ${cur(table, column)} end`;
  };
  const set: Record<string, SQL | undefined> = {
    open: ohlc("open"), high: ohlc("high"), low: ohlc("low"), close: ohlc("close"), previousClose: ohlc("previous_close"),
    volume: ohlc("volume"), adjClose: policy.primary ? ex("adj_close") : undefined,
    source: ownOrKeep(table, "source", policy.primary), asOf: ownOrKeep(table, "as_of", policy.primary), rawRef: ownOrKeep(table, "raw_ref", policy.primary),
    valueSource: valueProvenance("value_source"), valueRawRef: valueProvenance("value_raw_ref"),
    value: valueSet("value"), frequency: valueSet("frequency"),
    ...(policy.foreign ? {
      foreignBuy: ex("foreign_buy"), foreignSell: ex("foreign_sell"), foreignSource: ex("foreign_source"), foreignAsOf: ex("foreign_as_of"), foreignRawRef: ex("foreign_raw_ref"),
    } : {}),
  };
  for (const key of Object.keys(set)) if (set[key] === undefined) delete set[key];
  const valued = policy.value !== "none";
  for (const batch of chunks(rows)) {
    await db.insert(t.dailyPrices).values(batch.map((row) => ({
      symbol: row.symbol, date: row.date, open: row.open, high: row.high, low: row.low, close: row.close, previousClose: row.previousClose,
      volume: row.volume, adjClose: row.adjClose ?? null,
      value: valued ? row.value ?? null : null, frequency: valued ? row.frequency ?? null : null,
      valueSource: valued && row.value != null ? prov.source : null, valueRawRef: valued && row.value != null ? prov.rawRef : null,
      ...(policy.foreign ? {
        foreignBuy: row.foreignBuy ?? null, foreignSell: row.foreignSell ?? null,
        foreignSource: prov.source, foreignAsOf: prov.asOf, foreignRawRef: prov.rawRef,
      } : {}),
      source: prov.source, asOf: prov.asOf, rawRef: prov.rawRef,
    }))).onConflictDoUpdate({ target: [t.dailyPrices.symbol, t.dailyPrices.date], set });
  }
  return rows.length;
}

/** Symbols that have a daily row for `date` from `source` (any source when omitted). */
export async function symbolsWithDaily(db: EngineDb, date: string, source?: string): Promise<Set<string>> {
  const where = source ? and(eq(t.dailyPrices.date, date), eq(t.dailyPrices.source, source)) : eq(t.dailyPrices.date, date);
  const rows = await db.select({ symbol: t.dailyPrices.symbol }).from(t.dailyPrices).where(where);
  return new Set(rows.map((row) => row.symbol));
}

/** Symbols with foreign flow already stored for `date`. */
export async function symbolsWithForeign(db: EngineDb, date: string): Promise<Set<string>> {
  const rows = await db.select({ symbol: t.dailyPrices.symbol }).from(t.dailyPrices)
    .where(and(eq(t.dailyPrices.date, date), sql`${t.dailyPrices.foreignBuy} is not null`));
  return new Set(rows.map((row) => row.symbol));
}

/**
 * Active symbols ranked by traded value in the newest session at or before `date` that has values (most liquid
 * first); symbols without a value follow alphabetically.
 */
export async function symbolsByLiquidity(db: EngineDb, date: string): Promise<string[]> {
  const result = await db.execute<{ symbol: string }>(sql`
    with ref as (select max(date) as d from daily_prices where date <= ${date} and value is not null)
    select s.symbol from securities s
    left join daily_prices p on p.symbol = s.symbol and p.date = (select d from ref)
    where s.active
    order by p.value desc nulls last, s.symbol asc`);
  return [...result].map((row) => row.symbol);
}

// ── corporate_actions ───────────────────────────────────────────────────────────────────────────────────────────

export type ActionUpsert = { symbol: string; type: string; sourceCategory?: string | null; exDate: string; ratio?: string | null; amount?: number | null; shares?: number | null; sharesAfter?: number | null; description: string };

export async function upsertCorporateActions(db: EngineDb, rows: ActionUpsert[], prov: Provenance): Promise<number> {
  for (const batch of chunks(rows)) {
    await db.insert(t.corporateActions).values(batch.map((row) => ({
      symbol: row.symbol, type: row.type, sourceCategory: row.sourceCategory ?? null, exDate: row.exDate, ratio: row.ratio ?? null, amount: row.amount ?? null,
      shares: row.shares ?? null, sharesAfter: row.sharesAfter ?? null, description: row.description,
      source: prov.source, asOf: prov.asOf, rawRef: prov.rawRef,
    }))).onConflictDoUpdate({
      target: [t.corporateActions.source, t.corporateActions.symbol, t.corporateActions.type, t.corporateActions.exDate],
      set: { sourceCategory: ex("source_category"), ratio: ex("ratio"), amount: ex("amount"), shares: ex("shares"), sharesAfter: ex("shares_after"), description: ex("description"), asOf: ex("as_of"), rawRef: ex("raw_ref") },
    });
  }
  return rows.length;
}

// ── indices ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type IndexDailyUpsert = {
  code: string; date: string; name: string | null; open: number | null; high: number | null; low: number | null; close: number;
  previousClose: number | null; changePercent: number | null;
};

export async function upsertIndexDaily(db: EngineDb, rows: IndexDailyUpsert[], prov: Provenance, policy: { primary: boolean }): Promise<number> {
  const table = "index_daily";
  const col = (column: string) => ownOrKeep(table, column, policy.primary);
  for (const batch of chunks(rows)) {
    await db.insert(t.indexDaily).values(batch.map((row) => ({
      code: row.code, date: row.date, name: row.name, open: row.open, high: row.high, low: row.low, close: row.close, previousClose: row.previousClose,
      change: row.previousClose === null ? null : round(row.close - row.previousClose, 4), changePercent: row.changePercent,
      source: prov.source, asOf: prov.asOf, rawRef: prov.rawRef,
    }))).onConflictDoUpdate({
      target: [t.indexDaily.code, t.indexDaily.date],
      set: {
        name: sql`coalesce(${ex("name")}, ${cur(table, "name")})`,
        open: col("open"), high: col("high"), low: col("low"), close: col("close"), previousClose: col("previous_close"), change: col("change"),
        changePercent: col("change_percent"), source: col("source"), asOf: col("as_of"), rawRef: col("raw_ref"),
      },
    });
  }
  return rows.length;
}

export type IntradayInsert = {
  symbol: string; last: number | null; open: number | null; high: number | null; low: number | null;
  change: number | null; changePercent: number | null; volume: number | null; value: number | null;
};

/** One whole-market snapshot at `ts`; re-inserting the same snapshot is a no-op. */
export async function insertIntradaySnapshot(db: EngineDb, ts: Date, rows: IntradayInsert[], prov: Provenance): Promise<number> {
  for (const batch of chunks(rows)) {
    await db.insert(t.intradaySnapshots).values(batch.map((row) => ({ ...row, ts, source: prov.source, asOf: prov.asOf, rawRef: prov.rawRef })))
      .onConflictDoNothing();
  }
  return rows.length;
}

export type IndexIntradayInsert = { code: string; name: string | null; last: number; open: number | null; high: number | null; low: number | null; changePercent: number | null };

export async function insertIndexIntraday(db: EngineDb, ts: Date, rows: IndexIntradayInsert[], prov: Provenance): Promise<number> {
  if (!rows.length) return 0;
  await db.insert(t.indexIntraday).values(rows.map((row) => ({ ...row, ts, source: prov.source, asOf: prov.asOf, rawRef: prov.rawRef }))).onConflictDoNothing();
  return rows.length;
}

// ── eod_sessions ────────────────────────────────────────────────────────────────────────────────────────────────

export type SessionStatus = (typeof t.SESSION_STATUSES)[number];

export async function recordEodSession(db: EngineDb, date: string, state: { status: SessionStatus; expected: number; present: number; final: boolean }): Promise<void> {
  const now = new Date();
  await db.insert(t.eodSessions).values({ date, status: state.status, expected: state.expected, present: state.present, attempts: 1, finalizedAt: state.final ? now : null, updatedAt: now })
    .onConflictDoUpdate({
      target: t.eodSessions.date,
      set: {
        status: state.status, expected: state.expected, present: state.present, attempts: sql`${t.eodSessions.attempts} + 1`,
        finalizedAt: state.final ? now : sql`${t.eodSessions.finalizedAt}`, updatedAt: now,
      },
    });
}

export async function eodSession(db: EngineDb, date: string) {
  const [row] = await db.select().from(t.eodSessions).where(eq(t.eodSessions.date, date)).limit(1);
  return row ?? null;
}

export async function recentEodSessions(db: EngineDb, limit = 5) {
  return db.select().from(t.eodSessions).orderBy(sql`${t.eodSessions.date} desc`).limit(limit);
}

export async function markParsed(db: EngineDb, ids: string[]): Promise<void> {
  if (ids.length) await db.update(t.rawDocuments).set({ parseStatus: "PARSED", parseError: null }).where(inArray(t.rawDocuments.id, ids));
}

export function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
