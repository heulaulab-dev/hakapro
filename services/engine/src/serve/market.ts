// Builds idx-bei /v1 payloads from stored rows. Pure functions over a MarketStore; the HTTP layer validates every
// result with the shared Zod schemas (src/http/envelope.ts) before it leaves the engine.
//   Freshness: EOD/STALE from the session date with the shared IDX clock; intraday snapshots are always DELAYED
//   with their timestamp, never LIVE (§8.3). A quote uses the intraday snapshot only when it is from a newer
//   session than the newest daily row.
import type { z } from "zod";
import { classifySessionDate } from "@/lib/freshness/session";
import { rankMovers } from "@/lib/movers";
import type { Freshness } from "@/lib/freshness";
import type { actionsSchema, foreignSignalSchema, marketOverviewSchema, sectorsSchema, securitySchema, stockSchema } from "@/server/schemas/idx-bei";
import { wibDateOf, wibIso } from "../sources/session";
import type { DailyRecord, IndexDailyRecord, IndexIntradayRecord, IntradayRecord, MarketStore } from "./store";

export type Served<T> = { data: T; dataAsOf: string | null; freshness: Freshness };

/** Movers sent per view (gainers, losers, most active); the app ranks and trims them (src/lib/movers.ts). */
export const MOVERS_PER_VIEW = 50;
export const SIGNAL_LOOKBACK_SESSIONS = 20;
export const SIGNAL_LIMIT = 100;
export const DEFAULT_CANDLES = 500;
export const MAX_CANDLES = 5000;

const INDEX_ORDER = ["COMPOSITE", "LQ45", "IDX30"];
const ratio = (close: number | null, previous: number | null) => (close === null || !previous ? null : close / previous - 1);
const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

export function sessionFreshness(date: string | null, now: Date): Freshness {
  return classifySessionDate(date, now);
}

// ── /v1/securities ──────────────────────────────────────────────────────────────────────────────────────────────

export async function serveSecurities(store: MarketStore, query: string, now: Date): Promise<Served<z.input<typeof securitySchema>[]> | null> {
  const rows = await store.searchSecurities(query, query.trim() ? 50 : 2000);
  if (!rows.length) return null;
  const asOf = rows.reduce((latest, row) => (row.asOf > latest ? row.asOf : latest), rows[0].asOf);
  return {
    data: rows.map((row) => ({ symbol: row.symbol, companyName: row.name, sector: row.sector, subsector: row.subsector, board: row.board })),
    dataAsOf: wibDateOf(asOf), freshness: sessionFreshness(wibDateOf(asOf), now),
  };
}

// ── /v1/stocks/{s} ──────────────────────────────────────────────────────────────────────────────────────────────

export async function serveStock(store: MarketStore, symbol: string, limit: number, now: Date): Promise<Served<z.input<typeof stockSchema>> | null> {
  const [history, intraday] = await Promise.all([store.dailyHistory(symbol, Math.min(Math.max(limit, 1), MAX_CANDLES)), store.latestIntraday(symbol)]);
  const latest = history.at(-1) ?? null;
  const useIntraday = intraday !== null && intraday.last !== null && (!latest || wibDateOf(intraday.ts) > latest.date);
  if (!latest && !useIntraday) return null;
  const candles = history.map((row) => ({ time: row.date, open: row.open, high: row.high, low: row.low, close: row.close, volume: row.volume, foreignBuy: row.foreignBuy, foreignSell: row.foreignSell }));

  if (useIntraday) {
    const previousClose = latest?.close ?? (intraday.changePercent !== null && intraday.changePercent > -1 ? Math.round(intraday.last! / (1 + intraday.changePercent)) : null);
    const changePercent = previousClose ? ratio(intraday.last, previousClose) : intraday.changePercent;
    return {
      data: {
        quote: {
          symbol, timestamp: wibIso(intraday.ts), open: intraday.open, high: intraday.high, low: intraday.low, close: intraday.last,
          previousClose, change: previousClose === null ? null : intraday.last! - previousClose, changePercent,
          volume: intraday.volume, value: intraday.value, frequency: null, foreignBuy: null, foreignSell: null,
        },
        candles,
      },
      dataAsOf: wibIso(intraday.ts), freshness: "DELAYED",
    };
  }

  const row = latest!;
  const previousClose = row.previousClose ?? history.at(-2)?.close ?? null;
  return {
    data: {
      quote: {
        symbol, timestamp: row.date, open: row.open, high: row.high, low: row.low, close: row.close,
        previousClose, change: previousClose === null ? null : row.close - previousClose, changePercent: ratio(row.close, previousClose),
        volume: row.volume, value: row.value, frequency: row.frequency, foreignBuy: row.foreignBuy, foreignSell: row.foreignSell,
      },
      candles,
    },
    dataAsOf: row.date, freshness: sessionFreshness(row.date, now),
  };
}

// ── /v1/market ──────────────────────────────────────────────────────────────────────────────────────────────────

export type MarketRow = {
  symbol: string; close: number | null; changePercent: number | null; volume: number | null; value: number | null; frequency: number | null;
  /** Shares; only on EOD rows (intraday snapshots carry no foreign flow). */
  foreignBuy?: number | null; foreignSell?: number | null;
};

export function breadthOf(rows: MarketRow[]) {
  const breadth = { advancers: 0, decliners: 0, unchanged: 0, value: 0, volume: 0, frequency: 0 };
  for (const row of rows) {
    if (row.changePercent === null) continue;
    if (row.changePercent > 0) breadth.advancers += 1;
    else if (row.changePercent < 0) breadth.decliners += 1;
    else breadth.unchanged += 1;
    breadth.value += row.value ?? 0;
    breadth.volume += row.volume ?? 0;
    breadth.frequency += row.frequency ?? 0;
  }
  return breadth;
}

/** Union of the top gainers, losers and most active (same liquidity rule as the app's movers view). */
export function moversOf(rows: MarketRow[], names: Map<string, string>) {
  const movers = rows.map((row) => ({
    symbol: row.symbol, name: names.get(row.symbol) ?? null, close: row.close, changePercent: row.changePercent,
    volumeShares: row.volume, valueIdr: row.value, frequency: row.frequency,
  }));
  const picked = new Map<string, (typeof movers)[number]>();
  for (const view of ["gainers", "losers", "active"] as const) {
    for (const row of rankMovers(movers, view, MOVERS_PER_VIEW)) picked.set(row.symbol, row);
  }
  return [...picked.values()].map((row) => ({
    symbol: row.symbol, name: row.name, close: row.close, changePercent: row.changePercent, volume: row.volumeShares, value: row.valueIdr, frequency: row.frequency,
  }));
}

export function indicesOf(daily: IndexDailyRecord[], intraday: IndexIntradayRecord[]) {
  const byCode = new Map<string, { code: string; name: string | null; close: number; previousClose: number | null; changePercent: number | null; asOf: string }>();
  for (const row of daily) byCode.set(row.code, { code: row.code, name: row.name, close: row.close, previousClose: row.previousClose, changePercent: row.changePercent ?? ratio(row.close, row.previousClose), asOf: row.date });
  for (const row of intraday) {
    const day = byCode.get(row.code);
    // An intraday level replaces the daily row only when it is from a newer session.
    if (day && wibDateOf(row.ts) <= day.asOf) continue;
    const previousClose = day?.close ?? (row.changePercent !== null && row.changePercent > -1 ? round(row.last / (1 + row.changePercent), 3) : null);
    byCode.set(row.code, { code: row.code, name: row.name ?? day?.name ?? null, close: row.last, previousClose, changePercent: previousClose ? ratio(row.last, previousClose) : row.changePercent, asOf: wibIso(row.ts) });
  }
  const rank = (code: string) => (INDEX_ORDER.includes(code) ? INDEX_ORDER.indexOf(code) : INDEX_ORDER.length);
  return [...byCode.values()].sort((a, b) => rank(a.code) - rank(b.code) || a.code.localeCompare(b.code));
}

/**
 * The rows the market views are built from: the intraday snapshot when it is from a newer session than the newest
 * daily row (DELAYED), otherwise that session (EOD/STALE). Shared by /v1/market, /v1/sectors and the 1D /v1/groups so
 * all show the same change for a stock.
 */
export async function currentRows(store: MarketStore, now: Date): Promise<{ rows: MarketRow[]; dataAsOf: string | null; freshness: Freshness }> {
  const [sessionDate, snapshotTs] = await Promise.all([store.latestSessionDate(), store.latestSnapshotTs()]);
  if (snapshotTs !== null && (!sessionDate || wibDateOf(snapshotTs) > sessionDate)) {
    const snapshot = await store.snapshotRows(snapshotTs);
    const previous = await store.closesBefore(wibDateOf(snapshotTs), snapshot.map((row) => row.symbol));
    const rows = snapshot.map((row: IntradayRecord) => {
      const prev = previous.get(row.symbol) ?? null;
      return { symbol: row.symbol, close: row.last, changePercent: prev ? ratio(row.last, prev) : row.changePercent, volume: row.volume, value: row.value, frequency: null };
    });
    return { rows, dataAsOf: wibIso(snapshotTs), freshness: "DELAYED" };
  }
  if (!sessionDate) return { rows: [], dataAsOf: null, freshness: "UNAVAILABLE" };
  const rows = (await store.sessionRows(sessionDate)).map((row: DailyRecord) => ({
    symbol: row.symbol, close: row.close, changePercent: ratio(row.close, row.previousClose), volume: row.volume, value: row.value, frequency: row.frequency,
    foreignBuy: row.foreignBuy, foreignSell: row.foreignSell,
  }));
  return { rows, dataAsOf: sessionDate, freshness: sessionFreshness(sessionDate, now) };
}

export async function serveMarket(store: MarketStore, now: Date): Promise<Served<z.input<typeof marketOverviewSchema>> | null> {
  const [current, indexDaily, indexIntraday] = await Promise.all([currentRows(store, now), store.latestIndexDaily(), store.latestIndexIntraday()]);
  const { rows } = current;
  let { dataAsOf, freshness } = current;

  const indices = indicesOf(indexDaily, indexIntraday);
  if (!rows.length && !indices.length) return null;
  // Index-only data (no stock rows yet) still dates the response.
  if (!dataAsOf && indices.length) {
    dataAsOf = indices.map((row) => row.asOf).sort().at(-1)!;
    freshness = dataAsOf.length > 10 ? "DELAYED" : sessionFreshness(dataAsOf, now);
  }
  const names = new Map((await store.securities(rows.map((row) => row.symbol))).map((row) => [row.symbol, row.name]));
  return {
    data: {
      indices: indices.map((row) => ({ code: row.code, name: row.name, close: row.close, previousClose: row.previousClose, changePercent: row.changePercent })),
      breadth: breadthOf(rows),
      movers: moversOf(rows, names),
    },
    dataAsOf, freshness,
  };
}

// ── /v1/sectors ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Per-sector performance over the same rows as /v1/market: members with a change, advancers/decliners/unchanged,
 * the mean and the value-weighted change (fractions), traded value, and the sector's best and worst stock. Stocks
 * without a sector (not in the universe yet) are left out, never put in an invented bucket. Best change first.
 */
export async function serveSectors(store: MarketStore, now: Date): Promise<Served<z.input<typeof sectorsSchema>> | null> {
  const { rows, dataAsOf, freshness } = await currentRows(store, now);
  const priced = rows.filter((row) => row.changePercent !== null);
  if (!priced.length) return null;
  const sectorOf = new Map((await store.securities(priced.map((row) => row.symbol))).map((row) => [row.symbol, row.sector]));
  const groups = new Map<string, MarketRow[]>();
  for (const row of priced) {
    const sector = sectorOf.get(row.symbol);
    if (!sector) continue;
    groups.set(sector, [...(groups.get(sector) ?? []), row]);
  }
  if (!groups.size) return null;
  const sectors = [...groups.entries()].map(([sector, members]) => {
    const changes = members.map((row) => row.changePercent!);
    const value = members.reduce((sum, row) => sum + (row.value ?? 0), 0);
    const weighted = value > 0 ? members.reduce((sum, row) => sum + row.changePercent! * (row.value ?? 0), 0) / value : null;
    const sorted = [...members].sort((a, b) => b.changePercent! - a.changePercent!);
    return {
      sector, stocks: members.length,
      advancers: changes.filter((change) => change > 0).length, decliners: changes.filter((change) => change < 0).length, unchanged: changes.filter((change) => change === 0).length,
      changePercent: changes.reduce((sum, change) => sum + change, 0) / changes.length, valueWeightedChangePercent: weighted, value,
      leader: { symbol: sorted[0].symbol, changePercent: sorted[0].changePercent }, laggard: { symbol: sorted.at(-1)!.symbol, changePercent: sorted.at(-1)!.changePercent },
    };
  }).sort((a, b) => b.changePercent - a.changePercent);
  return { data: sectors, dataAsOf, freshness };
}

// ── /v1/signals ─────────────────────────────────────────────────────────────────────────────────────────────────

type Signal = z.input<typeof foreignSignalSchema>;

/**
 * Foreign-flow radar: for each stock with foreign data on the newest session, the run of consecutive sessions with
 * net foreign flow in the same direction, its total, the average traded value over that run, and the total as a
 * share of free-float shares. Ranked by the run's net value (net shares × close).
 */
export function foreignSignals(rows: DailyRecord[], tradingDate: string, floatShares: Map<string, number>): Signal[] {
  const dates = [...new Set(rows.map((row) => row.date))].sort().reverse();
  const bySymbol = new Map<string, Map<string, DailyRecord>>();
  for (const row of rows) {
    if (!bySymbol.has(row.symbol)) bySymbol.set(row.symbol, new Map());
    bySymbol.get(row.symbol)!.set(row.date, row);
  }
  const signals: Array<Signal & { weight: number }> = [];
  for (const [symbol, history] of bySymbol) {
    const today = history.get(tradingDate);
    if (!today || today.foreignBuy === null || today.foreignSell === null) continue;
    const direction = Math.sign(today.foreignBuy - today.foreignSell);
    if (direction === 0) continue;
    let net = 0;
    let sessions = 0;
    const values: number[] = [];
    for (const date of dates) {
      const row = history.get(date);
      if (!row || row.foreignBuy === null || row.foreignSell === null || Math.sign(row.foreignBuy - row.foreignSell) !== direction) break;
      net += row.foreignBuy - row.foreignSell;
      sessions += 1;
      if (row.value !== null) values.push(row.value);
    }
    const float = floatShares.get(symbol);
    signals.push({
      symbol, close: today.close, sessions,
      netForeignMillionShares: round(net / 1e6, 4),
      percentFloat: float ? round((net / float) * 100, 4) : null,
      averageValueBillionIdr: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length / 1e9, 4) : null,
      signal: direction > 0 ? "accumulate" : "distribute",
      weight: Math.abs(net * today.close),
    });
  }
  return signals.sort((a, b) => b.weight - a.weight).slice(0, SIGNAL_LIMIT).map(({ weight: _weight, ...signal }) => signal);
}

export async function serveSignals(store: MarketStore, now: Date): Promise<Served<{ tradingDate: string; foreignFlow: Signal[] }> | null> {
  const tradingDate = await store.latestForeignDate();
  if (!tradingDate) return null;
  const rows = await store.foreignHistory(tradingDate, SIGNAL_LOOKBACK_SESSIONS);
  const securities = await store.securities([...new Set(rows.map((row) => row.symbol))]);
  const floatShares = new Map<string, number>();
  for (const row of securities) {
    if (row.sharesOutstanding && row.freeFloatPct) floatShares.set(row.symbol, (row.sharesOutstanding * row.freeFloatPct) / 100);
  }
  return { data: { tradingDate, foreignFlow: foreignSignals(rows, tradingDate, floatShares) }, dataAsOf: tradingDate, freshness: sessionFreshness(tradingDate, now) };
}

// ── /v1/stocks/{s}/actions ──────────────────────────────────────────────────────────────────────────────────────

export async function serveActions(store: MarketStore, symbol: string, now: Date): Promise<Served<z.input<typeof actionsSchema>> | null> {
  const rows = await store.actions(symbol);
  if (!rows.length) return null;
  const asOf = wibDateOf(rows.reduce((latest, row) => (row.asOf > latest ? row.asOf : latest), rows[0].asOf));
  return {
    data: [...rows].sort((a, b) => (b.exDate ?? "").localeCompare(a.exDate ?? "")).map((row) => ({ date: row.exDate, type: row.type, description: row.description, documentUrl: null })),
    dataAsOf: asOf, freshness: sessionFreshness(asOf, now),
  };
}
