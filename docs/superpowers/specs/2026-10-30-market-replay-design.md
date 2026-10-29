# Market Replay

## Intent

Give users one date-controlled view of how IDX breadth, sector performance, and leading issuers moved together. Existing pages expose issuer race, historical breadth, sector index closes, and RRG separately; this page synchronizes those persisted observations so users can inspect the market context behind a date.

## Goals and constraints

- Add a discoverable Market Replay destination under the existing Pulse navigation group.
- Reuse existing Engine APIs and records. No new scraper, vendor, schema, or database is needed.
- Default to the 1M window so the module works with short production price histories; allow 3M, 6M, and 1Y.
- Use only exact-date observations for the selected frame. Missing breadth or index data must be shown as unavailable for that session, never forward-filled.
- Show the active session, current dataset freshness, issuer coverage, and partial-universe status.
- Support play, pause, step, and date slider. Respect `prefers-reduced-motion` by hiding autoplay while retaining manual controls.
- Keep descriptive wording; this is historical context, not a forecast or recommendation.

## Approaches considered

1. Add a synchronized replay page using existing issuer-race, breadth-history, and index-history APIs. Recommended: it combines established data without new operational dependencies.
2. Add more visualizations to `/discover/rotation`. Rejected because breadth and sector context are currently separate analytics and a replay needs room for shared controls and coverage.
3. Add a new feed or historical backfill source. Rejected because the Engine already persists all required series and source access is the limiting factor.

## Behavior

The selected date comes from the issuer-race frames. For that exact date, display the race leaders, breadth counts and participation metrics, and the chosen sector index's close-relative return against IHSG from the race baseline date. A metric whose selected date or baseline is absent displays a localized unavailable state. Coverage from each source stays visible so sparse history is not mistaken for a full-market series.

## Builder calls

- Market Replay is an app page; no Engine changes are required.
- The initial sector comparison is IDX Finance versus IHSG, with a sector selector for available IDX-IC series.
- Reuse the existing chart/controls and app APIs; do not fetch a separate price request per issuer.
