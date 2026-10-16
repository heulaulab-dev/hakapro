// Registered sources for E2/E2b (DATA-ENGINE.md §5.11, §8.5–8.6). Policies are per host: one request in flight and
// 2–3 s apart, so ~900 Yahoo calls spread over ~45 minutes of the evening window.
import type { ArjumConfig } from "../config";
import { defineSource, type SourceDefinition } from "../registry";
import { PASARDANA_HOST } from "./pasardana";
import { TRADINGVIEW_HOST } from "./tradingview";
import { YAHOO_HOST } from "./yahoo";

export const SOURCE_IDS = { tradingview: "tradingview-scanner", yahoo: "yahoo-chart", pasardana: "pasardana", arjum: "arjum" } as const;

export type EngineSources = { tradingview: SourceDefinition; yahoo: SourceDefinition; pasardana: SourceDefinition; arjum: SourceDefinition | null };

export function engineSources(arjum: ArjumConfig | null): EngineSources {
  return {
    // Also the intraday poller, so it is an intraday source (one request in flight, §8.3).
    tradingview: defineSource({ id: SOURCE_IDS.tradingview, host: TRADINGVIEW_HOST, kind: "intraday", policy: { minIntervalMs: 2000, concurrency: 1 }, description: "TradingView scanner: universe, EOD cross-check, indices, intraday (10 min delayed)" }),
    yahoo: defineSource({ id: SOURCE_IDS.yahoo, host: YAHOO_HOST, kind: "eod", policy: { minIntervalMs: 3000, concurrency: 1 }, description: "Yahoo chart: daily OHLCV, splits, dividends, IHSG history" }),
    pasardana: defineSource({ id: SOURCE_IDS.pasardana, host: PASARDANA_HOST, kind: "reference", policy: { minIntervalMs: 3000, concurrency: 1 }, description: "Pasardana GetAll: sectors, capitalisation, free float, value/frequency" }),
    arjum: arjum
      ? defineSource({ id: SOURCE_IDS.arjum, host: new URL(arjum.baseUrl).host, kind: "eod", policy: { minIntervalMs: 2000, concurrency: 1 }, description: "arjum /api/history: foreign buy/sell within the daily budget" })
      : null,
  };
}
