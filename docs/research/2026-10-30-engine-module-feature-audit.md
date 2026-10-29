# Engine-backed feature opportunities

Date: 2026-10-30
Audit base: `origin/main` at `6c7652dd72845be29cd29fe830cb3f456bc9cc4b`.
Scope: identify user-facing analytics that can be derived from the current Engine; no production data or secrets accessed.

## Recommendation

The requested examples are already represented in the shipped code: HakaPro has a sector RRG, a stock-versus-sector-peer RRG, and an animated issuer performance race. The next incremental feature should be a **Market Replay** that synchronizes the existing issuer race with historical market breadth and sector performance. It would make the race explain the market context on every date rather than show only the names leading that frame. It can be derived from `daily_prices` and current security-to-sector metadata; it does not need another feed or scraper.

Before adding another collector, fix the data-rights and freshness gates for the underlying EOD records. The Engine documentation classifies Yahoo and TradingView as unofficial/internal experiment sources. IDX's terms prohibit web scraping/crawling and require permission for commercial use; TradingView's current terms prohibit automated collection. A new scraper against either source is not an acceptable data-coverage fix. If a public production module needs more rows/history, acquire a licensed source or use an authorized file-delivery workflow.

## What is already implemented

| Capability | Engine implementation | User-facing implementation | Important boundary |
|---|---|---|---|
| Sector rotation / RRG-style scatter | `/v1/sector-rotation`, uses stored sector-index and IHSG closes; transparent formula in `src/lib/sector-rotation.ts` | `/discover/rotation` | The RRG calculation is HakaPro's approximation, not the proprietary JdK formula. Data depth and index coverage gate usable points. |
| Stock rotation within a sector | `/v1/sector-rotation/stocks`, equal-weight sector-peer basket from daily closes | Stock Rotation view | Requires adequate continuous issuer/peer history and minimum liquidity. A missing close breaks the series instead of being carried forward. |
| Issuer performance race | `/v1/issuer-race`, exact common baseline session, date-stepped frames, sector filter, bounded leader list | `IssuerRacePanel` inside `/discover/rotation` | Current contract returns up to 12 leaders per frame and frame coverage; the race does not itself explain breadth/sector context. |
| Daily breadth | `/v1/breadth` | Market intelligence views | Derived from observed market daily rows; it cannot establish complete exchange participation if the source session is partial. |
| Breadth history | `/v1/breadth/history` with 1M/3M/6M/1Y windows | Market intelligence views | Already exposes advancers/decliners, net-advance rate, cumulative pressure, above-SMA20 participation, and advancing/declining value with coverage. |
| Signal radar | `/v1/radar`; versioned thresholds, per-signal availability and counter-evidence | Radar workspace | Foreign-flow and KSEI-dependent signals can be missing; missing is distinct from zero. |
| Broker activity | `broker_daily_summaries` read/serve path | Broker Activity module | Its reported session coverage and whether concentration can be calculated are explicit; do not assume unreported brokers are zero. |
| KSEI ≥1% ownership | ownership snapshots, changes and screener | Ownership / 1% Screener; issuer ownership tab | Monthly operator-provided snapshots, not IDX-BEI profile shareholder disclosures. Snapshot month must remain visible and must not be described as current when stale. |
| Dividends and patterns | KSEI cash-dividend schedule plus stored price/action history | Dividend calendar/pattern views | KSEI-confirmed dates and estimated projections are distinct. Historical patterns need adequate clean price history. |

Primary code references: `services/engine/src/http/app.ts` (routes), `services/engine/src/serve/issuer-race.ts`, `services/engine/src/serve/stock-sector-rotation.ts`, `services/engine/src/serve/breadth.ts`, `services/engine/src/serve/radar.ts`, `services/engine/src/serve/market.ts`, `services/engine/src/db/market-store.ts`, `services/engine/src/db/ownership.ts`, `src/app/[locale]/(app)/discover/rotation/issuer-race-panel.tsx`, `src/app/[locale]/(app)/discover/rotation/rotation-view.tsx`, `src/app/[locale]/(app)/discover/broker-activity/broker-activity-view.tsx`, and `docs/research/sector-rotation-analysis.md`.

## New feature candidates

### 1. Market Replay — recommended next

**Experience:** a shared session slider drives (a) the issuer leaderboard/race, (b) advancers versus decliners and above-SMA20 participation, and (c) sector leaders/laggards for that same session. Playback keeps the selected trading date visible. Selecting a sector filters the leaderboard while preserving the all-market breadth context.

**Data:** existing `daily_prices` closes/value, `securities.sector`, and the existing breadth and issuer-race derivations. The server should expose one joined, bounded response (or a response that returns identical frame dates to the existing APIs) so the panels cannot drift to different selected dates. Rank only exact observed closes; show `priced / eligible` and the `eod_sessions` status for the date. Missing rows must not be carried or backfilled in the UI.

**Why it is a real addition:** the issuer race already answers “which stocks led?” while breadth history answers “how many stocks participated?” Market Replay puts those answers on the same date axis. It is an interpretive view of reported data, not a new signal or forecast.

**Implementation outline:** extend `issuer-race` frame construction (or add `/v1/market/replay`) to include breadth counts and per-sector equal-weight return/coverage per selected frame. Reuse the race's frame stepping and the `serveBreadthHistory` counting rules. Keep payload bounds, common baseline, deterministic ties, and per-frame coverage. UI can add a compact participation strip above the existing animated leaderboard. The current `IssuerRacePanel` already respects reduced motion and exposes manual stepping.

**Tests:** exact-date alignment across all panels; no forward-filled symbols; partially covered session shown as partial; all-null sector values remain unavailable; stable ranking ties; reduced-motion playback disabled but slider/step controls retained; all points bounded by selected date.

### 2. Foreign-flow participation map — useful only with measured coverage

Aggregate observed daily foreign buy/sell into (a) share of covered stocks with net foreign buying, (b) net flow by sector, and (c) price/foreign-flow disagreement. Engine already stores `foreignBuy` and `foreignSell` on some `daily_prices` records and has per-stock flow and radar derivations.

This must report `flow-observed / eligible` counts at both market and sector levels. The `foreign-flow` job explicitly has a configurable request budget/reserve and stops before exhausting the provider quota; symbols it does not reach remain null. Therefore full-market foreign breadth is not guaranteed by the presence of a latest flow date. First measure production coverage for each recent session. If coverage is too thin or biased to the highest-liquidity names, label the result as a liquid-stock sample or do not show the aggregate. A new scraper is not inherently required; if expanding coverage, use the existing authorized provider entitlement or a licensed source.

### 3. Monthly ownership network replay — data-gated

The KSEI ≥1% snapshots and month-over-month changes can support an investor-to-issuer network with month selection and node/edge detail. Its freshness is monthly and dependent on the latest uploaded KSEI snapshot. Show the exact snapshot month on the graph and a clear empty/stale state. Do not infer ownership below 1%, missing cross-holdings, or equivalence with IDX-BEI profile disclosures. If there is no newer authorized KSEI monthly file, this module cannot be made fresh by scraping the IDX website: IDX's terms prohibit scraping and KSEI access remains blocked in the engine source investigation.

### 4. Commodity / sector co-movement — lower priority, careful wording

The Engine has a World Bank Pink Sheet adapter for monthly commodity observations, and daily price histories can be converted to monthly sector/issuer returns. A chart could compare coal/CPO/nickel/gold changes with IDX sector or issuer returns using common monthly observations. Use correlation/co-movement language only, show observation count and source dates, and explicitly state it does not establish cause or predict returns. Do not rank issuer “exposure” unless HakaPro has a sourced business-segment mapping. This is lower priority until the daily price history and index-sector licensing/freshness questions are resolved.

## Data and rights constraints

- The current feature methods read persisted Engine rows; no additional feed is necessary for Market Replay.
- The Engine's provider notes state Yahoo chart history is blocked/rate-limited in production and TradingView scanning is an unofficial source. A successful parser or scheduled job is not evidence that the data is complete or licensed for public redistribution.
- IDX's official terms permit noncommercial quotation only with full attribution and access date, and disallow web scraping/crawling: [IDX Terms of Use](https://www.idx.co.id/id/syarat-penggunaan).
- TradingView's official terms prohibit automated data collection, including scripts/APIs/scraping: [TradingView Terms of Service](https://www.tradingview.com/policies/).
- The 2026-10-26 source audit already investigated licensed IDX delivery, vendor EOD, and operator uploads. It records that public/full-market use requires a written licence/reuse grant and that operator upload does not alter source rights: `docs/research/2026-10-26-engine-data-sources.md`.
- RRG remains an independent approximation: RRG Research says the named RS-Ratio/RS-Momentum formula is proprietary, so keep the existing “RRG-style” / approximation wording and do not present numerical equivalence: [RRG Research — building blocks](https://relativerotationgraphs.com/educational/the-building-blocks-for-rrg/).

## Recommended order

1. Verify current production EOD session completeness and recent foreign-flow coverage; record counts and dates, not just HTTP 200 or provider health.
2. Build Market Replay from the persisted rows already available, including per-frame/session coverage and freshness labels.
3. Add foreign-flow participation only if real, recent coverage supports a fair market-wide or explicitly sampled view.
4. Add ownership network replay only when an authorized recent monthly KSEI snapshot is present.
5. Defer more source scraping. When deeper/full-universe EOD history is actually required, pursue an IDX/vendor licence or authorized delivery and then add that source to the Engine's fetcher, provenance, coverage, and blocking controls.

## Sources inspected

- HakaPro source and tests at `origin/main` commit `6c7652d` (listed above).
- HakaPro `docs/research/sector-rotation-analysis.md`, `docs/research/2026-10-26-engine-data-sources.md`, `docs/features/DATA-ENGINE.md`, and `services/engine/README.md`.
- [IDX Terms of Use](https://www.idx.co.id/id/syarat-penggunaan).
- [TradingView Terms of Service](https://www.tradingview.com/policies/).
- [RRG Research — The Building Blocks for RRG](https://relativerotationgraphs.com/educational/the-building-blocks-for-rrg/).
- [World Bank Commodity Markets data terms](https://data.worldbank.org/summary-terms-of-use), referenced only for the existing commodity adapter; verify the workbook attribution and release details before launching any new public presentation.
