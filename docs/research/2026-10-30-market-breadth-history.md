# Market breadth history from existing Engine data

## Finding

HakaPro already has the inputs and route for a current-session breadth snapshot. `daily_prices` stores close, previous close, and traded value, and `MarketStore.sessionHistory(endDate, sessions)` can read a bounded set of market sessions. The current `/discover/intelligence` page only renders a single snapshot. A historical breadth panel therefore adds useful market context without another scraper, data vendor, or database.

## Candidate assessment

| Feature | Existing data fit | Action |
| --- | --- | --- |
| Sector Relative Rotation Graph and issuer race | Sector-index history and daily stock prices | Already implemented on `/discover/rotation`; keep methodology and freshness visible. |
| Historical market breadth | Daily closes, previous closes, traded value, session history | Build next. Add cumulative normalized advance/decline pressure, % above the 20-session average, and advancing/declining traded value. |
| Investor/issuer network and one-percent screener | Uploaded monthly KSEI snapshots | Already implemented; preserve the disclosure/snapshot distinction and snapshot date. |
| Volume/price anomaly scans | EOD OHLCV | Possible later, but a cross-sectional 20-day baseline needs stable coverage and source freshness before presenting alerts. |
| More broker-flow analysis | Broker summary records and arjum per-stock data | Available in existing modules; avoid conflating broker codes with identified beneficial owners. |

## Metric definitions for the new panel

- **Advance / decline / unchanged:** compare each issuer close with its previous close. If the source omits a previous close, use that issuer's latest earlier stored close. Rows without a valid comparison are excluded from the movement denominator and counted as coverage gaps.
- **Cumulative breadth pressure:** begin at zero and add `(advancers - decliners) / comparable issuers * 100` percentage points per session. This normalization limits distortion when the number of covered listings changes. It is a descriptive in-house series, not an official exchange index and not the conventional raw-count A/D line.
- **Above 20-session average:** among issuers with 20 stored closes through a session, count closes strictly above their trailing 20-close arithmetic mean. Report the eligible issuer count; missing history is excluded, never classified as below average.
- **Turnover breadth:** sum traded value for advancing and declining issuers with known value. Report known-value row coverage. Unchanged issuers are excluded from the directional ratio; this is not TRIN and does not identify buyer/seller intent.
- **Freshness:** expose the latest market session date and classify it using the shared IDX session clock. Historical values are not labelled current when the latest session is stale.

## Sources

- HakaPro Engine contracts and implementation: `services/engine/src/serve/store.ts` (`sessionHistory`), `services/engine/src/db/market-store.ts`, `services/engine/src/serve/breadth.ts`, `src/server/schemas/market-intelligence.ts`.
- ICE's chart-study documentation defines the conventional advance/decline line as cumulative advancing issues minus declining issues: [ICE A/D Line](https://download.dataservices.theice.com/products/marketq/help/charts/chart_studies/available_chart_studies/a_d_line.htm). HakaPro's normalized pressure series is intentionally labelled separately.
- TradingView's help documentation describes advancing/declining-market breadth as a way to inspect participation beyond index levels: [Market Breadth](https://www.tradingview.com/support/solutions/43000794825-market-breadth-advancing-and-declining/). HakaPro's turnover metric is separately labelled and does not claim to reproduce TRIN.

## Guardrails

- Do not add a new data source or invent missing observations.
- Keep outputs bounded to at most 252 displayed sessions plus 19 warm-up sessions.
- Use existing Engine API authentication, app-session authorization, `{data, meta}` envelope, and shared freshness vocabulary.
- Explain that breadth metrics are descriptive analytics, not recommendations.
