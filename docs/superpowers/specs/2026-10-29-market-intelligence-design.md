# Market Intelligence Design

## Intent

Turn HakaPro's existing market, IDX-BEI, KSEI, fundamentals, news, corporate-action, broker, and macro datasets into three connected discovery experiences:

1. Catalyst Radar: a stock-level explanation of recent events and data changes.
2. Market Breadth & Regime: delayed whole-market participation and leadership context.
3. Ownership Network Explorer: provenance-aware corporate ownership overlap from KSEI snapshots.

## Goals

- Reuse existing engine contracts and datasource provenance; no new provider is required.
- Show `asOf`, freshness, source, and delayed status for every derived view.
- Keep unofficial TradingView/Yahoo/Pasardana data labelled as experimental/delayed.
- Make empty, stale, unavailable, and ambiguous data honest instead of implying certainty.
- Ship each experience independently behind existing or new explicit feature flags.

## Non-goals

- No foreign-flow claims beyond the existing Arjum fields.
- No legal ownership inference from IDX-BEI shareholder disclosures.
- No new scraping, licensing, or redistribution of blocked IDX/KSEI sources.
- No automatic enabling of TradingView logos or strategy scans.

## Feature contracts

### Catalyst Radar

Add a read-only `GET /v1/stocks/{symbol}/catalysts` response containing normalized events from issuer profile updates, ownership changes, actions, news, fundamentals/ratios, and broker/market divergence. Each event has `kind`, `headline`, `detail`, `occurredAt`, `source`, `asOf`, `freshness`, and a confidence label. Events are sorted newest first and capped at 20. Missing datasets produce an honest empty section, not fabricated events.

### Market Breadth & Regime

Add `GET /v1/breadth` with delayed snapshot metadata, advancing/declining/unchanged counts when available, sector leadership/laggards, concentration, and a derived regime label (`RISK_ON`, `RISK_OFF`, `MIXED`, `UNAVAILABLE`). Derived labels are explicitly marked experimental and include the input timestamp.

### Ownership Network Explorer

Extend the existing ownership response with a graph-ready `network` object: issuer nodes, corporate-holder nodes, exact-match edges, and an `ambiguous` count. Only exact normalized issuer-name matches inside the same KSEI snapshot are included. Cross-holding edges must carry source upload, month, and confidence; no fuzzy matching.

## UX

- Add a unified `Market Intelligence` page under Discover with three cards/tabs.
- Add a Catalyst card to the stock page above the existing lower-detail tabs.
- Reuse existing Panel, MetricCard, freshness, empty-state, and table components.
- Use color only for semantic positive/negative/warning states; decorative depth stays neutral.
- Respect reduced motion and mobile/tablet layouts.

## Rollout

- `ENGINE_CATALYSTS_ENABLED`, `ENGINE_BREADTH_ENABLED`, and `ENGINE_OWNERSHIP_NETWORK_ENABLED` default off in production and can be enabled per environment after verification.
- App routes and UI remain safe when a flag is off: show a documented unavailable state.

## Verification

- Unit tests for event normalization, breadth regime thresholds, exact ownership matching, stale metadata, and empty sources.
- Engine route contract tests.
- App API adapter/component tests.
- Playwright desktop/mobile/tablet fixture coverage for all three states.
