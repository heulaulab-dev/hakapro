import { previousTradingDay } from "@/lib/freshness";

export type DailyClose = { date: string; close: number; change: number; changePercent: number };
export type PriceLike = { sessionDate: string | null; lastPriceIdr: number };
export type MergedQuote = { date: string; close: number; change: number | null; changePercent: number | null; fromPrice: boolean };

function against(date: string, close: number, previous: DailyClose | undefined): MergedQuote {
  if (!previous || previous.close === 0) return { date, close, change: null, changePercent: null, fromPrice: true };
  const change = close - previous.close;
  return { date, close, change, changePercent: Math.round((change / previous.close) * 10_000) / 100, fromPrice: true };
}

/**
 * Combines ascending daily history with today's price (`/api/price`). The price is used only for the
 * history's latest session or the trading day right after it; the change is always against the
 * previous session's close and never spans a gap in the history (then it is null).
 */
export function mergeLastPrice(rows: DailyClose[], price: PriceLike | null | undefined): MergedQuote | null {
  const latest = rows.at(-1);
  const session = price?.sessionDate;
  if (!price || !session) return latest ? { ...latest, fromPrice: false } : null;
  if (!latest) return { date: session, close: price.lastPriceIdr, change: null, changePercent: null, fromPrice: true };
  if (session < latest.date) return { ...latest, fromPrice: false };
  if (session === latest.date) return rows.length > 1 ? against(session, price.lastPriceIdr, rows.at(-2)) : { ...latest, close: price.lastPriceIdr, fromPrice: true };
  return previousTradingDay(session) === latest.date ? against(session, price.lastPriceIdr, latest) : { date: session, close: price.lastPriceIdr, change: null, changePercent: null, fromPrice: true };
}
