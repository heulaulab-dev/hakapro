# Investor Network Replay

## Intent and goals

Build a standalone HakaPro module that lets the owner explore listed-company holders disclosed in each KSEI ≥1% snapshot already stored by the Engine. Show one point-in-time network at a time, exact snapshot dates, issuer coverage, source references, and changes only when the immediately preceding calendar-month snapshot exists and the Engine marked that issuer comparison `COMPARED`.

The graph is limited to corporate holders matched exactly to issuer names in the same snapshot. A searchable, sortable table remains the complete alternative for all disclosed lines. The screen must distinguish an unavailable comparison from an empty change set and must never imply that ≥1% rows are total ownership, trades, accumulation, or money flows.

## Non-goals and constraints

- No new database, table, migration, KSEI/IDX scraper, or source collector.
- No fuzzy entity matching, investor identity enrichment, or inference below the reported threshold.
- Do not compare across a missing calendar month. Keep existing ownership upload and feature-flag controls intact.
- Data remains an owner-uploaded personal/internal research dataset pending written permission for broader redistribution. Preserve upload references and dates.
- Add no external runtime dependency; use the existing SVG, table, routing, and query patterns.

## Approaches considered

1. **Investor Network Replay from stored KSEI uploads (chosen):** reuses the exact-match graph and monthly change records already built by the Engine; adds only a month-list read, bounded month response, and UI. It gives a distinct network/replay experience while keeping source semantics visible.
2. Quarterly Earnings Momentum: existing Yahoo fundamentals are marked unofficial/internal and redistribution rights and production coverage are unverified; do not amplify this feed into a public leaderboard.
3. Market-wide foreign-flow map: collection is intentionally budget-limited and biased toward liquid names; a market-wide view would need a separate coverage audit and could misstate breadth.

## Product and data behavior

- Standalone route `/discover/investor-network`, with its own sidebar entry outside Ownership and 1% Screener.
- Month picker contains only months that have stored issuer sets, newest first; default to latest available month.
- Engine response is bounded to one requested month and includes available months, snapshot date, issuer and holder-row counts, exact-match graph, ambiguous-match count, source references, and comparison metadata.
- If the calendar-previous month is absent, or an issuer's comparison is not `COMPARED`, show that comparison as unavailable and omit its deltas from summary counts. Never bridge to another month.
- Graph renders exact matched corporate-holder → issuer edges with stake labels, topological limits for readability, and keyboard-accessible edge/issuer details. A searchable table includes all disclosed holdings in the selected month.
- Header states the exact month and snapshot date. Methodology states “KSEI disclosed holdings ≥1%; incomplete below threshold; personal/internal analysis”. Historical records are never labeled current.

## Implementation calls left to the builder

Use the shared `OwnershipStore` interface for available months and month-bounded reads. Keep graph derivation in the Engine's existing exact-match helper. Use the existing authenticated BFF route pattern and shared Zod contracts. Add English and Indonesian copy, responsive layout, and a source/provenance link on rows when present.
