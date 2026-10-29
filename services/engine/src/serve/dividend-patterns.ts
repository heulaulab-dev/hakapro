import { deriveDividendPatterns } from "../derive/dividend-patterns";
import { sessionFreshness, type Served } from "./market";
import type { MarketStore } from "./store";
import type { DividendPatterns } from "@/server/schemas/dividend-patterns";
import { SOURCE_IDS } from "../sources";

/** Reads stored split-adjusted prices and cash-dividend amounts; no live provider call on an app request. */
export async function serveDividendPatterns(store: MarketStore, symbol: string, now: Date): Promise<Served<DividendPatterns> | null> {
  const prices = await store.dailyHistory(symbol, 1600);
  const latest = prices.at(-1);
  if (!latest) return null;
  const start = new Date(`${latest.date}T00:00:00Z`);
  start.setUTCFullYear(start.getUTCFullYear() - 5);
  const end = new Date(Date.parse(`${latest.date}T00:00:00Z`) + 365 * 86_400_000).toISOString().slice(0, 10);
  const actions = await store.actionsBetween(start.toISOString().slice(0, 10), end);
  const result = deriveDividendPatterns(
    prices.map((row) => ({ date: row.date, close: row.close, value: row.value })),
    actions.filter((row) => row.symbol === symbol && row.source === SOURCE_IDS.yahoo && row.type === "DIVIDEND" && row.amount !== null)
      .map((row) => ({ exDate: row.exDate, amount: row.amount! })),
  );
  if (!result) return null;
  return { data: { symbol, ...result }, dataAsOf: result.asOf, freshness: sessionFreshness(result.asOf, now) };
}
