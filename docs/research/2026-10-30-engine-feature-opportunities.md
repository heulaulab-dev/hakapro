# Next HakaPro features from data already in the Engine

Date: 2026-10-30
Scope: identify useful additions from current Engine storage and routes, prioritizing features that need no new scraper or vendor.

## Recommendation: Broker Activity / concentration explorer

Build a market-wide **Broker Activity** page from the IDX `GetBrokerSummary` daily broker totals already ingested by the Engine. It can show a daily broker turnover leaderboard, each broker's share of total reported value, a 5/20-session activity comparison, and the concentration of activity among the largest firms (top-five share / HHI). A race or bump chart can show firms gaining and losing turnover share over time.

This is a market-participation view, not a per-stock broker-flow view. It must not label a broker a buyer or seller: the source records market-wide volume, value and frequency by broker code, without side or ticker attribution. Keep the module title and copy explicit about that grain.

### Evidence that the data already exists

- `services/engine/src/sources/idx-broker-summary.ts` fetches `/TradingSummary/GetBrokerSummary` and validates date, broker code, firm name, volume, value and frequency. The source comment explicitly states its grain is market-wide date × broker, not date × stock × broker.
- `services/engine/src/jobs/idx-broker-backfill.ts` uses the resumable backfill scheduler from `BACKFILL_START` through the current WIB date. It refuses to advance on an empty/invalid day and reports unavailable days as failures rather than fabricating zeroes.
- `services/engine/src/db/idx-broker.ts` stores rows on a `(date, brokerCode)` key and supports date-range reads. `idxBrokerMembers` separately stores the IDX member directory, refreshed by `services/engine/src/jobs/idx-broker-directory.ts` on trading weekdays.
- `services/engine/src/serve/market-info.ts` already builds `/v1/brokers/market-summary` with dates and broker totals sorted by value. The contract in `src/server/schemas/idx-bei.ts` describes exactly those fields. `src/server/market/idx-bei-source.ts` consumes it, and `/api/brokers/market-summary` is already present. `rg` found no user-facing component or hook consuming the market-wide endpoint, so the missing work is primarily product UI and derived metrics, not ingestion.
- The official [IDX Broker Summary page](https://www.idx.co.id/id/data-pasar/ringkasan-perdagangan/ringkasan-broker) exposes a broker search and date selection. The [IDX Data Services catalog](https://data.idx.co.id/catalog_product2.php?p=XLoi5RtfUJ8SBrm) lists equity EOD recapitulation products with volume and foreign/domestic buy/sell fields. These support the distinction between market-data products and any claim that the public broker-summary table identifies trade direction.

### Freshness and coverage gates

Before displaying the chart, inspect actual production `broker_daily_summaries` dates and the job cursor / source health. The endpoint currently returns all dates in a requested range and the latest date, but does not describe missing expected sessions. Add or compute a coverage report before calling a time range complete: sessions expected, dates present, rows per session, zero/partial days, and the latest successful import. Use IDX trading sessions where available; do not count weekends as missing.

For each selected date, derive each broker's reported value share as `broker.value / sum(reported broker values that day)` only when the denominator and row coverage are valid. Name it “share of reported broker-summary value”; do not imply it is the share of all exchange turnover until reconciled to the official market total. HHI should be labelled as a concentration measure over reported rows, and only shown when the source response appears complete. Preserve `dataAsOf` and stale classification from the endpoint.

## Other opportunities and why they rank later

| Opportunity | Existing data | Assessment |
| --- | --- | --- |
| Historical market breadth | `daily_prices`, bounded session history; now implemented on the `feat/market-breadth-history` branch and merged to `develop` as PR #151 | Best immediate promotion: no new source. Finish staged/prod rollout before opening another overlapping breadth view. |
| Foreign-flow persistence vs price | `foreign_buy` / `foreign_sell` fields and `/v1/signals`; `foreign-flow` job is limited by an arjum daily request budget and reserve, so coverage is deliberately partial | Add only with per-session symbol coverage and a clear “covered symbols” denominator. Existing stock Flow and radar already expose per-stock data, so a broad market heatmap risks overstating coverage. |
| Quarterly earnings momentum league | Yahoo fundamentals with quarterly/annual net income, EPS, revenue and balance-sheet metrics | Useful, but requires freshness, comparable period, currency/unit and missing-company coverage handling; Yahoo analyst coverage is not the full IDX universe. Better as a follow-up after coverage is audited. |
| Direct reciprocal ownership network | Monthly KSEI ≥1% snapshot parser/store and conservative exact issuer matching are already implemented in `services/engine/src/serve/ownership.ts` | Existing ownership UI now has reciprocal company links. The threshold list is incomplete and periodic; expand only with verified name mapping and retain point-in-time warnings. |

## Suggested v1 screen

1. **Date range**: 1M / 3M / 6M / 1Y, default 3M; show latest source date and a visible coverage state.
2. **Daily concentration chart**: top-five share and HHI on separate, documented axes, with gaps for missing sessions.
3. **Broker activity race**: selected top 5–10 brokers ranked by traded value share by session, with name/code sourced from the IDX member directory.
4. **Daily table**: broker, reported value, reported volume, frequency, value share, and change against that broker's 20-session median. Clearly distinguish absent rows from zero activity.
5. **Methodology note**: market-wide aggregates; no buy/sell side, ticker attribution, customer identity, or proof of accumulation/distribution.

No scraper should be added for this feature unless production coverage checks show the current scheduled IDX feed is insufficient. First use the existing authenticated Engine adapter and repair its coverage/operational issues if found.

## Immediate execution order

1. Complete promotion and production verification of PR #151 (historical breadth); the latest repo release evidence should be rechecked before claiming it is live.
2. Query/verify actual `broker_daily_summaries` coverage and import freshness on production.
3. If coverage supports it, build the Broker Activity module against the existing authenticated API, with integration tests proving missing-day and incomplete-response behavior.
4. Promote by feature PR → develop → staging → main. Do not add a second source or change licensing assumptions in this UI-only increment.
