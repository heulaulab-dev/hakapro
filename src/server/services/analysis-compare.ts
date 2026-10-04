import "server-only";
import { leastFresh, withFreshness, type FreshnessMeta, type WithFreshness } from "@/lib/freshness";
import { MarketDataError } from "@/server/market/errors";
import type { MarketDataSource } from "@/server/market/source";
import type { StockAnalysis } from "@/server/market/types";

export type ComparedAnalysis =
  | ({ symbol: string; status: "ok"; data: StockAnalysis } & FreshnessMeta)
  | { symbol: string; status: "error"; error: string };

/**
 * Analyses for up to five symbols, fetched one after another (one provider request each).
 * After a rate limit the remaining symbols are not requested and report RATE_LIMITED, so a
 * comparison is never presented as complete when it is not.
 */
export async function compareAnalyses(source: MarketDataSource, symbols: string[], signal?: AbortSignal): Promise<WithFreshness<ComparedAnalysis[]>> {
  const items: ComparedAnalysis[] = [];
  let stopped = false;
  for (const symbol of symbols) {
    if (stopped) { items.push({ symbol, status: "error", error: "RATE_LIMITED" }); continue; }
    try {
      const envelope = await source.analysis(symbol, signal);
      items.push({ symbol, status: "ok", data: envelope.data, freshness: envelope.freshness, asOf: envelope.asOf, period: envelope.period, source: envelope.source });
    } catch (error) {
      if (error instanceof MarketDataError && (error.code === "NOT_CONFIGURED" || error.code === "PROVIDER_UNAUTHORIZED")) throw error;
      const code = error instanceof MarketDataError ? error.code : "INTERNAL_ERROR";
      if (code === "RATE_LIMITED") stopped = true;
      items.push({ symbol, status: "error", error: code });
    }
  }
  const ok = items.filter((item): item is Extract<ComparedAnalysis, { status: "ok" }> => item.status === "ok");
  const oldest = ok.map((item) => item.asOf).filter((asOf): asOf is string => asOf !== null).sort()[0] ?? null;
  return withFreshness(items, { freshness: leastFresh(ok.map((item) => item.freshness)), asOf: ok.length ? oldest : null, source: source.id });
}
