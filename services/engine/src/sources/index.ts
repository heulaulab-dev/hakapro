// Registered sources for E2/E2b/E3 (DATA-ENGINE.md §5.11, §8.5–8.6). Policies are per host: one request in flight and
// 2–3 s apart for most price sources; Yahoo 5 s apart (it rate-limited the engine's server at 3 s), so ~900 Yahoo
// calls spread over ~75 minutes of the evening window; at least 5 s apart for the news outlets and Bank Indonesia,
// which are fetched a handful of times per run.
import type { ArjumConfig } from "../config";
import { defineSource, type SourceDefinition } from "../registry";
import { BI_HOST } from "./bi";
import { NEWS_FEEDS, NEWS_SOURCE_IDS } from "./news";
import { PASARDANA_HOST } from "./pasardana";
import { TRADINGVIEW_HOST } from "./tradingview";
import { YAHOO_HOST } from "./yahoo";

export const SOURCE_IDS = {
  tradingview: "tradingview-scanner", yahoo: "yahoo-chart", yahooFundamentals: "yahoo-fundamentals", pasardana: "pasardana", arjum: "arjum", bi: "bank-indonesia",
} as const;

/** Yahoo chart + fundamentals (one host): 5 s between requests, one in flight. */
export const YAHOO_POLICY = { minIntervalMs: 5000, concurrency: 1 } as const;

/** News outlets and BI: 5 s between requests to one host, one in flight. */
export const MARKET_INFO_POLICY = { minIntervalMs: 5000, concurrency: 1 } as const;

export type EngineSources = {
  tradingview: SourceDefinition; yahoo: SourceDefinition; yahooFundamentals: SourceDefinition; pasardana: SourceDefinition; arjum: SourceDefinition | null;
  news: SourceDefinition[]; bi: SourceDefinition;
};

export function engineSources(arjum: ArjumConfig | null): EngineSources {
  const outlets = new Map(NEWS_FEEDS.map((feed) => [feed.sourceId, feed]));
  return {
    // Also the intraday poller, so it is an intraday source (one request in flight, §8.3).
    tradingview: defineSource({ id: SOURCE_IDS.tradingview, host: TRADINGVIEW_HOST, kind: "intraday", policy: { minIntervalMs: 2000, concurrency: 1 }, description: "TradingView scanner: universe, EOD cross-check, indices, intraday (10 min delayed)" }),
    yahoo: defineSource({ id: SOURCE_IDS.yahoo, host: YAHOO_HOST, kind: "eod", policy: { ...YAHOO_POLICY }, description: "Yahoo chart: daily OHLCV, splits, dividends, IHSG history" }),
    // Same host as the chart, so the fetcher's per-host limiter keeps one request in flight, 5 s apart, across both.
    // Its own id, so a block of the fundamentals path shows separately; a 429 on either rests both (jobs/fundamentals).
    yahooFundamentals: defineSource({ id: SOURCE_IDS.yahooFundamentals, host: YAHOO_HOST, kind: "reference", policy: { ...YAHOO_POLICY }, description: "Yahoo fundamentals timeseries: annual and quarterly statement lines" }),
    pasardana: defineSource({ id: SOURCE_IDS.pasardana, host: PASARDANA_HOST, kind: "reference", policy: { minIntervalMs: 3000, concurrency: 1 }, description: "Pasardana GetAll: sectors, capitalisation, free float, value/frequency" }),
    arjum: arjum
      ? defineSource({ id: SOURCE_IDS.arjum, host: new URL(arjum.baseUrl).host, kind: "eod", policy: { minIntervalMs: 2000, concurrency: 1 }, description: "arjum /api/history: foreign buy/sell within the daily budget" })
      : null,
    news: Object.values(NEWS_SOURCE_IDS).map((id) => {
      const feed = outlets.get(id)!;
      return defineSource({ id, host: feed.host, kind: "news", policy: { ...MARKET_INFO_POLICY }, description: `${feed.outlet} RSS: headline, link, time, feed summary` });
    }),
    bi: defineSource({ id: SOURCE_IDS.bi, host: BI_HOST, kind: "macro", policy: { ...MARKET_INFO_POLICY }, description: "Bank Indonesia: BI-Rate and JISDOR tables (first page only)" }),
  };
}
