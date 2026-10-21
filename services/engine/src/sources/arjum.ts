// arjum (DATA-ENGINE.md §8.5c): per-stock foreign buy/sell from its documented `/api/history/{code}` endpoint, the
// same endpoint and response shape the app uses (src/server/schemas/arjum.ts, docs/MIGRATION.md §11). The engine
// shares the 1000/day key quota with the app, so it spends at most ENGINE_ARJUM_DAILY_BUDGET calls and stops while
// x-ratelimit-remaining is below ENGINE_ARJUM_RESERVE. A 429 blocks the source (fetcher), like every other source.
// The insider feed reads `/api/insiders/{code}` the same way, parsed by the app's own normalizer (normalizeInsiders).
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";
import { buildProviderUrl } from "@/server/providers/arjum/queries";
import { historyResponseSchema, insidersResponseSchema } from "@/server/schemas/arjum";
import { normalizeInsiders, type InsiderRow, type NumberIssue } from "@/server/services/arjum-normalize";

/** The provider's minimum history page (20 sessions): one call per stock also fills the previous sessions. */
export const ARJUM_HISTORY_ROWS = ARJUM_LIMITS.historyMinRows;

export function historyUrl(baseUrl: string, symbol: string, rows = ARJUM_HISTORY_ROWS): string {
  return buildProviderUrl(baseUrl, `/api/history/${symbol}`, { limit: rows });
}

/** Page 1 of a symbol's insider transactions, newest first, at the provider's largest page (15). */
export function insidersUrl(baseUrl: string, symbol: string): string {
  return buildProviderUrl(baseUrl, `/api/insiders/${symbol}`, { page: 1, limit: ARJUM_LIMITS.insiders });
}

export type ArjumInsider = {
  person: string; roles: string[]; action: InsiderRow["action"]; date: string;
  sharesChange: number | null; sharesBefore: number | null; sharesAfter: number | null;
  /** Percent units, as published (0.0061 = 0.0061%). */
  percentBefore: number | null; percentAfter: number | null; percentChange: number | null;
  /** IDR; null when the provider reports none ("0"). */
  price: number | null;
  broker: string | null; nationality: string | null;
};

/** Rows with a usable date and person; numbers the normalizer could not read come back as `issues` (never guessed). */
export function parseInsiders(textBody: string, symbol: string): { total: number; rows: ArjumInsider[]; issues: NumberIssue[] } {
  const parsed = insidersResponseSchema.parse(JSON.parse(textBody));
  if (parsed.stock_code.toUpperCase() !== symbol) throw new Error(`arjum insiders for ${parsed.stock_code} returned where ${symbol} was requested`);
  const { data, issues } = normalizeInsiders(parsed);
  const rows = data.rows
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.person.trim() !== "")
    .map((row) => ({
      person: row.person.trim().replace(/\s+/g, " "), roles: row.roles.map((role) => role.trim()).filter(Boolean), action: row.action, date: row.date,
      sharesChange: row.changeShares, sharesBefore: row.previousShares, sharesAfter: row.currentShares,
      percentBefore: row.previousPercent, percentAfter: row.currentPercent, percentChange: row.changePercent,
      price: row.priceIdr !== null && row.priceIdr > 0 ? row.priceIdr : null,
      broker: row.broker?.trim() || null, nationality: row.nationality.trim() || null,
    }));
  return { total: data.total, rows, issues };
}

export type ArjumSession = {
  date: string; open: number; high: number; low: number; close: number; previousClose: number;
  volume: number; value: number; frequency: number; foreignBuy: number; foreignSell: number;
};

export function parseHistory(textBody: string, symbol: string): ArjumSession[] {
  const parsed = historyResponseSchema.parse(JSON.parse(textBody));
  if (parsed.stock_code.toUpperCase() !== symbol) throw new Error(`arjum history for ${parsed.stock_code} returned where ${symbol} was requested`);
  return parsed.rows
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date))
    .map((row) => ({
      date: row.date, open: row.open, high: row.high, low: row.low, close: row.close, previousClose: row.close - row.change,
      volume: Math.round(row.volume), value: Math.round(row.value), frequency: Math.round(row.freq),
      foreignBuy: Math.round(row.f_buy), foreignSell: Math.round(row.f_sell),
    }));
}

/** Daily quota left as the provider reports it (`x-ratelimit-remaining`), or null when absent. */
export function quotaRemaining(headers: Headers): number | null {
  const raw = headers.get("x-ratelimit-remaining");
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
