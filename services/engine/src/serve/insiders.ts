// `/v1/insiders/recent`: the market-wide insider feed from what the `insider-feed` job has read so far, with the honest
// coverage of that rotation (symbols read within the revisit window out of the active universe). Pure over an
// InsiderStore; the HTTP layer validates the payload with `insidersRecentSchema` (src/server/schemas/idx-bei.ts).
import type { z } from "zod";
import type { insidersRecentSchema } from "@/server/schemas/idx-bei";
import { addDays, wibToday } from "../sources/session";
import type { Served } from "./market";

export const INSIDER_ACTION_FILTERS = ["buy", "sell", "cross"] as const;
export type InsiderActionFilter = (typeof INSIDER_ACTION_FILTERS)[number];
export const INSIDERS_DEFAULT_DAYS = 7;
export const INSIDERS_MAX_DAYS = 30;
export const INSIDERS_DEFAULT_LIMIT = 50;
export const INSIDERS_MAX_LIMIT = 200;
/** ENGINE_ARJUM_INSIDER_REVISIT_DAYS default: the window coverage is measured over. */
export const DEFAULT_INSIDER_REVISIT_DAYS = 7;

export type InsiderTransactionRecord = {
  symbol: string; person: string; roles: string[]; action: "BUY" | "SELL" | "CROSS" | "OTHER"; date: string;
  sharesChange: number | null; sharesBefore: number | null; sharesAfter: number | null;
  percentBefore: number | null; percentAfter: number | null; percentChange: number | null;
  price: number | null; broker: string | null; nationality: string | null; source: string; asOf: Date;
};

export type InsiderCoverage = {
  /** Active symbols read on or after `since`, and the oldest such read. */
  checked: number; active: number; oldestCheck: string | null;
  /** The newest read of any symbol; null when the job has never read one. */
  newestCheckAt: Date | null;
};

export interface InsiderStore {
  /** Transactions dated on or after `from`, newest first (then largest value), at most `limit`. */
  recent(query: { from: string; action?: InsiderActionFilter; limit: number }): Promise<InsiderTransactionRecord[]>;
  coverage(since: string): Promise<InsiderCoverage>;
}

export type RecentInsidersQuery = { days: number; action?: InsiderActionFilter; limit: number };
type RecentInsiders = z.input<typeof insidersRecentSchema>;

/** Absolute traded value in IDR (|shares| × price), when both are known. */
export const transactionValue = (row: Pick<InsiderTransactionRecord, "sharesChange" | "price">) =>
  row.sharesChange === null || row.price === null ? null : Math.abs(row.sharesChange) * row.price;

/** The window and coverage for a request; `from` is `days` calendar days before today (WIB), inclusive. */
export function insidersWindow(now: Date, days: number, revisitDays: number) {
  const to = wibToday(now);
  return { from: addDays(to, -days), to, since: addDays(to, -revisitDays + 1) };
}

/** The empty form: no read yet (job never ran, or the feed is off), so nothing can be stated about the market. */
export function emptyRecentInsiders(now: Date, query: RecentInsidersQuery, revisitDays: number, active = 0): RecentInsiders {
  const { from, to } = insidersWindow(now, query.days, revisitDays);
  return { days: query.days, from, to, action: query.action ?? null, coverage: { checked: 0, active, revisitDays, oldestCheck: null }, transactions: [] };
}

/** `served` is null until the first read; `empty` is the empty form for that case (with the active universe size). */
export async function serveRecentInsiders(store: InsiderStore, query: RecentInsidersQuery, revisitDays: number, now: Date): Promise<{ served: Served<RecentInsiders> | null; empty: RecentInsiders }> {
  const { from, to, since } = insidersWindow(now, query.days, revisitDays);
  const coverage = await store.coverage(since);
  const empty = emptyRecentInsiders(now, query, revisitDays, coverage.active);
  if (!coverage.newestCheckAt) return { served: null, empty };
  const rows = await store.recent({ from, action: query.action, limit: query.limit });
  return { empty, served: {
    data: {
      days: query.days, from, to, action: query.action ?? null,
      coverage: { checked: coverage.checked, active: coverage.active, revisitDays, oldestCheck: coverage.oldestCheck },
      transactions: rows.map((row) => ({
        symbol: row.symbol, person: row.person, roles: row.roles, action: row.action, date: row.date,
        sharesChange: row.sharesChange, sharesBefore: row.sharesBefore, sharesAfter: row.sharesAfter,
        percentBefore: row.percentBefore, percentAfter: row.percentAfter, percentChange: row.percentChange,
        price: row.price, value: transactionValue(row), broker: row.broker, nationality: row.nationality,
        source: row.source, asOf: row.asOf.toISOString(),
      })),
    },
    // Dated by the newest read: the feed is as current as the rotation, never a market-wide snapshot.
    dataAsOf: coverage.newestCheckAt.toISOString(),
    freshness: "HISTORICAL",
  } };
}

/** In-memory store for unit and contract tests. */
export class MemoryInsiderStore implements InsiderStore {
  constructor(private readonly data: { transactions: InsiderTransactionRecord[]; checks: Array<{ symbol: string; checkedDate: string; asOf: Date }>; active: string[] }) {}

  async recent(query: { from: string; action?: InsiderActionFilter; limit: number }) {
    const value = (row: InsiderTransactionRecord) => transactionValue(row) ?? -1;
    return this.data.transactions
      .filter((row) => row.date >= query.from && (!query.action || row.action === query.action.toUpperCase()))
      .sort((a, b) => (a.date === b.date ? value(b) - value(a) || a.symbol.localeCompare(b.symbol) : a.date < b.date ? 1 : -1))
      .slice(0, query.limit);
  }

  async coverage(since: string) {
    const active = new Set(this.data.active);
    const recent = this.data.checks.filter((check) => active.has(check.symbol) && check.checkedDate >= since);
    const newest = this.data.checks.map((check) => check.asOf.getTime()).sort((a, b) => b - a)[0];
    return {
      checked: recent.length, active: active.size,
      oldestCheck: recent.map((check) => check.checkedDate).sort()[0] ?? null,
      newestCheckAt: newest === undefined ? null : new Date(newest),
    };
  }
}
