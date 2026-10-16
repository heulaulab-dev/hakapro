// arjum (DATA-ENGINE.md §8.5c): per-stock foreign buy/sell from its documented `/api/history/{code}` endpoint, the
// same endpoint and response shape the app uses (src/server/schemas/arjum.ts, docs/MIGRATION.md §11). The engine
// shares the 1000/day key quota with the app, so it spends at most ENGINE_ARJUM_DAILY_BUDGET calls and stops while
// x-ratelimit-remaining is below ENGINE_ARJUM_RESERVE. A 429 blocks the source (fetcher), like every other source.
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";
import { buildProviderUrl } from "@/server/providers/arjum/queries";
import { historyResponseSchema } from "@/server/schemas/arjum";

/** The provider's minimum history page (20 sessions): one call per stock also fills the previous sessions. */
export const ARJUM_HISTORY_ROWS = ARJUM_LIMITS.historyMinRows;

export function historyUrl(baseUrl: string, symbol: string, rows = ARJUM_HISTORY_ROWS): string {
  return buildProviderUrl(baseUrl, `/api/history/${symbol}`, { limit: rows });
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
