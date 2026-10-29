# Historical Market Breadth Design

The Intelligence page currently shows one breadth snapshot. This change adds a bounded history view built only from the Engine's stored `daily_prices` rows.

## User experience

- Keep the current-session regime, advancer/decliner counts, and sector snapshot.
- Add 1M, 3M, 6M, and 1Y range controls.
- Show a normalized cumulative breadth-pressure line, percent of eligible stocks above their 20-session average, and the share of directional traded value belonging to advancing stocks.
- Display the latest session date, freshness, observation count, and eligible sample sizes. Distinguish an empty/stale result from a valid zero.
- Include a brief methodology note: descriptive measures, no prediction or recommendation; sample coverage varies with available history.

## Data and API

- Add `GET /v1/breadth/history?window=1M|3M|6M|1Y` to the Engine, gated by the existing breadth flag and API token.
- Use `MarketStore.sessionHistory` for `displayedSessions + 19` observations, with maximum 271 market sessions.
- Build daily movement counts from close vs previous close, falling back to the latest earlier close for the same symbol. Exclude rows without a valid comparison and expose coverage counts.
- Build cumulative pressure as the sum of each day's normalized net advance rate in percentage points.
- Compute 20-session SMA participation only for symbols with 20 valid closes. Expose its eligible count per session.
- Sum traded value by advancing/declining groups; expose value-observation coverage.
- Return source, snapshot date, freshness, selected window and ascending per-session observations through the shared Zod envelope.
- Add a protected app BFF route `/api/breadth/history`, shared schema/client/hook, and query key. Keep caching private and short-lived.

## Out of scope

- New scraping, vendor integrations, migrations, 50/200-session moving averages, TRIN, claims of an official A/D index, trade recommendations, and changes to the separate sector RRG module.

## Failure behavior

- Missing/stale datasets remain unavailable or stale with source/date metadata; do not synthesize data.
- Rows with unknown prior close, 20-session history, or traded value are omitted from the relevant metric denominator and reflected in coverage.
- The existing `/v1/breadth` response and app must remain backward compatible.
