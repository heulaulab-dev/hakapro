# Broker Activity design

## Intent

Give HakaPro users a market-wide view of IDX broker participation over time. The Engine already stores daily IDX `GetBrokerSummary` totals by date and broker; this module makes that dataset explorable without suggesting it identifies buyers, sellers, individual stocks, or investors.

## Goals

- Add a standalone `Broker Activity` module in desktop and mobile navigation.
- Offer 1M, 3M, 6M, and 1Y windows, a broker value-share race, current rankings, and market concentration context.
- Show the latest source date, freshness, and gaps against dates available in Engine EOD history.
- Provide an accessible table alternative and clear methodology.
- Use the existing Engine source and endpoint. Add no scraper, vendor, or database migration.

## Non-goals and anti-goals

- No ticker-level broker-flow claims, buy/sell direction, client identity, or accumulation/distribution interpretation.
- No zero-filling absent broker records or missing dates.
- No claim that the sum is total exchange turnover; shares use only reported broker-summary values.
- No new source or inferred broker coverage when source rows are incomplete.

## Approaches

1. **Single-day leaderboard only:** minimal and avoids historical coverage work, but hides participation changes and leaves an existing historical endpoint unused.
2. **Historical activity race plus coverage-aware concentration (chosen):** extend the current summary response with expected EOD session dates and per-date broker row counts; derive value shares and rankings from the existing daily broker rows. This gives users useful movement while exposing missing source days and preserves the source grain.
3. **Build a ticker-level broker collector:** rejected because the existing IDX summary endpoint does not carry ticker or side, and adding a scraper cannot recover fields the source does not expose.

## Behavior

- Windows are bounded to 366 calendar days. Default is 3M.
- Expected dates are the market session dates present in Engine `daily_prices` during the selected window; the page labels this reference explicitly and shows reported versus reference sessions.
- Per-date broker share is `broker.value / sum(reported broker.value for that date)`, only for a positive reported denominator.
- Top-five share and HHI are shown only for dates where the endpoint did not hit its 100-row cap. HHI uses the reported rows and is labeled as concentration of reported value.
- The race uses the top six brokers by total reported value within the selected window and plots their daily share; absent dates remain gaps.
- Tables retain zeros only when the source explicitly reported zero and use an em dash for missing values.
- Freshness is inherited from Engine response metadata. Stale or unavailable data must remain visible and must not be presented as current.

## Constraints

- Keep all market API requests behind the existing authenticated app BFF.
- Keep response parsing backward-compatible with the currently deployed Engine while the Engine rollout catches up.
- Add English and Indonesian copy, accessible chart descriptions, and a table view.
- Use existing chart, panel, freshness, navigation, and query patterns; no dependency additions.

## Implementation calls

- Page route: `/discover/broker-activity`.
- Navigation: standalone module with a chart icon, outside the Ownership group.
- Engine API extension is additive and optional at the app schema boundary.
- The research evidence and source links are in `docs/research/2026-10-30-engine-feature-opportunities.md`.
