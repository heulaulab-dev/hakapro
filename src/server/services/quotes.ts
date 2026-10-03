import "server-only";
import { leastFresh, withFreshness, type FreshnessMeta, type WithFreshness } from "@/lib/freshness";
import { MarketDataError } from "@/server/market/errors";
import type { MarketDataSource } from "@/server/market/source";

export const MAX_QUOTES = 30;

export type Quote =
  | ({ symbol: string; status: "ok"; date: string; close: number; change: number; changePercent: number } & FreshnessMeta)
  | { symbol: string; status: "error"; error: string };

/**
 * Latest daily close for several symbols (watchlists). One failing symbol never hides the others;
 * the envelope is as fresh as the stalest quote and as-of its oldest date.
 */
export async function getQuotes(source: MarketDataSource, symbols: string[], signal?: AbortSignal): Promise<WithFreshness<Quote[]>> {
  const quotes = await Promise.all(symbols.slice(0, MAX_QUOTES).map(async (symbol): Promise<Quote> => {
    try {
      const envelope = await source.history(symbol, { frame: "daily", limit: 2 }, signal);
      const latest = envelope.data.rows.at(-1);
      if (!latest) return { symbol, status: "error", error: "EMPTY" };
      return { symbol, status: "ok", date: latest.date, close: latest.close, change: latest.change, changePercent: latest.changePercent, freshness: envelope.freshness, asOf: envelope.asOf, period: envelope.period, source: envelope.source };
    } catch (error) {
      if (error instanceof MarketDataError && (error.code === "NOT_CONFIGURED" || error.code === "PROVIDER_UNAUTHORIZED")) throw error;
      return { symbol, status: "error", error: error instanceof MarketDataError ? error.code : "INTERNAL_ERROR" };
    }
  }));
  const ok = quotes.filter((quote): quote is Extract<Quote, { status: "ok" }> => quote.status === "ok");
  const oldest = ok.map((quote) => quote.asOf).filter((asOf): asOf is string => asOf !== null).sort()[0] ?? null;
  return withFreshness(quotes, { freshness: leastFresh(ok.map((quote) => quote.freshness)), asOf: ok.length ? oldest : null, source: source.id });
}
