import "server-only";
import { jakartaClock, leastFresh, marketPhase, withFreshness, type FreshnessMeta, type WithFreshness } from "@/lib/freshness";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";
import { mergeLastPrice } from "@/lib/last-price";
import { MarketDataError } from "@/server/market/errors";
import type { MarketDataSource } from "@/server/market/source";
import type { LastPrice } from "@/server/market/types";

export const MAX_QUOTES = 30;

export type Quote =
  | ({
    symbol: string; status: "ok"; date: string; close: number; change: number | null; changePercent: number | null;
    /** Time of the last trade today (WIB) when the quote is today's price; null for a daily close. */
    lastTradeTime: string | null;
    marketState: LastPrice["marketState"] | null;
  } & FreshnessMeta)
  | { symbol: string; status: "error"; error: string };

const meta = (envelope: WithFreshness<unknown>): FreshnessMeta => ({ freshness: envelope.freshness, asOf: envelope.asOf, period: envelope.period, source: envelope.source });

/**
 * Latest quote for several symbols (watchlists). Each symbol's daily history gives the previous close;
 * on a trading day, once the session has opened, today's price is added (one more request per symbol).
 * Outside sessions today's price would only repeat the last close, so it is not requested.
 * One failing symbol never hides the others; the envelope is as fresh as the stalest quote.
 */
export async function getQuotes(source: MarketDataSource, symbols: string[], signal?: AbortSignal, now: Date = new Date()): Promise<WithFreshness<Quote[]>> {
  const phase = marketPhase(jakartaClock(now));
  const withPrice = phase === "in_progress" || phase === "closed";
  const quotes = await Promise.all(symbols.slice(0, MAX_QUOTES).map(async (symbol): Promise<Quote> => {
    try {
      const [history, price] = await Promise.all([
        source.history(symbol, { frame: "daily", limit: ARJUM_LIMITS.historyMinRows }, signal),
        // Today's price is an addition: without it the daily close still stands.
        withPrice ? source.price(symbol, signal).catch(() => null) : Promise.resolve(null),
      ]);
      const merged = mergeLastPrice(history.data.rows, price?.data);
      if (!merged) return { symbol, status: "error", error: "EMPTY" };
      const fromPrice = merged.fromPrice && price !== null;
      return {
        symbol, status: "ok", date: merged.date, close: merged.close, change: merged.change, changePercent: merged.changePercent,
        lastTradeTime: fromPrice ? price.data.lastTradeTime : null, marketState: price?.data.marketState ?? null,
        ...meta(fromPrice ? price : history),
      };
    } catch (error) {
      if (error instanceof MarketDataError && (error.code === "NOT_CONFIGURED" || error.code === "PROVIDER_UNAUTHORIZED")) throw error;
      return { symbol, status: "error", error: error instanceof MarketDataError ? error.code : "INTERNAL_ERROR" };
    }
  }));
  const ok = quotes.filter((quote): quote is Extract<Quote, { status: "ok" }> => quote.status === "ok");
  const oldest = ok.map((quote) => quote.asOf).filter((asOf): asOf is string => asOf !== null).sort()[0] ?? null;
  return withFreshness(quotes, { freshness: leastFresh(ok.map((quote) => quote.freshness)), asOf: ok.length ? oldest : null, source: source.id });
}
