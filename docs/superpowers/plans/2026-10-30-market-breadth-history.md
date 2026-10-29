# Historical Market Breadth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Market Intelligence with a dated breadth timeline computed from the Engine's existing EOD data.

**Architecture:** Add a pure Engine derivation and bounded authenticated endpoint, then a typed app adapter and responsive charts on the existing Intelligence page. No datasource or schema migration is required.

**Tech Stack:** Bun/TypeScript, Drizzle-backed `MarketStore`, Zod, Next.js 16 Route Handlers, TanStack Query, Recharts.

**Spec:** `docs/superpowers/specs/2026-10-30-market-breadth-history-design.md`

## Global Constraints

- Use only Engine `daily_prices` and existing source/freshness metadata.
- Cap displayed history at 252 sessions plus 19 warm-up sessions.
- Treat unavailable observations as coverage gaps; never invent them.
- Keep metrics descriptive, with no recommendation language.
- Keep the existing `/v1/breadth` API compatible and preserve route authentication.

## Review Focus

- A missing prior close or a stock's first session is excluded from the directional denominator; test the resulting coverage.
- A stock needs 20 valid closes to enter SMA participation; test that missing history is excluded rather than labelled below average.
- A session with unknown traded value reports partial value coverage; test the denominator and directional turnover share.
- A stale/latest-missing dataset retains correct freshness/unavailable metadata; test Engine response metadata.
- Each requested range is bounded and gets exactly the needed warm-up observations; test 1M and 1Y bounds.

---

### Task 1: Engine breadth-history derivation and route

**Files:**
- Modify: `services/engine/src/serve/breadth.ts`
- Modify: `services/engine/src/http/app.ts`
- Modify: `services/engine/src/http/app.test.ts`
- Modify: `src/server/schemas/market-intelligence.ts`
- Modify: `src/server/market/idx-bei-source.ts`
- Modify: `src/server/market/source.ts`
- Modify: `services/engine/src/serve/store.ts` only if the in-memory store contract lacks `sessionHistory`
- Test: `services/engine/src/serve/breadth.test.ts`

**Interfaces:**
- Consumes: `MarketStore.sessionHistory(endDate, sessions)`, existing `sessionFreshness(date, now)`, and breadth flag/API-token middleware.
- Produces: `GET /v1/breadth/history?window=1M|3M|6M|1Y`, returning `{window,snapshotDate,source,freshness,series:[{date,advancers,decliners,unchanged,comparable,coverage,netAdvanceRate,cumulativePressure,aboveSma20Pct,aboveSma20Eligible,advancingValueIdr,decliningValueIdr,valueCoverage,advancingValueShare}]}`.

- [ ] Write tests for comparisons, missing coverage, 20-close warm-up, turnover coverage, and bounded windows.
- [ ] Run `bunx vitest run services/engine/src/serve/breadth.test.ts` and confirm the new tests fail for missing derivation behavior.
- [ ] Implement a pure derivation over ascending session records; derive the latest date and freshness using existing helpers.
- [ ] Add the validated query and route behind the existing breadth feature gate, preserving `{data,meta}`.
- [ ] Add route tests for a valid range and invalid query.
- [ ] Run focused Engine tests and typecheck.

### Task 2: App BFF and typed client

**Files:**
- Create: `src/app/api/breadth/history/route.ts`
- Modify: `src/server/schemas/market-intelligence.ts`
- Modify: `src/lib/api/market.ts`
- Modify: `src/lib/api/hooks.ts`
- Modify: `src/lib/query/keys.ts`
- Test: API route test beside the new route (if existing API test conventions apply)

**Interfaces:**
- Consumes: the Engine history contract from Task 1.
- Produces: `engineApi.breadthHistory(window, signal?)` and `useBreadthHistory(window)`.

- [ ] Write a route/client contract test for window passthrough and protected-session behavior.
- [ ] Run the focused test and confirm it fails before implementation.
- [ ] Implement the server BFF and typed TanStack Query hook using the existing `marketRoute` pattern.
- [ ] Run focused tests and app typecheck.

### Task 3: Intelligence timeline UI

**Files:**
- Modify: `src/app/[locale]/(app)/discover/intelligence/intelligence-view.tsx`
- Create: `src/app/[locale]/(app)/discover/intelligence/breadth-history-charts.tsx`
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/id.json`
- Test: `tests/e2e/intelligence.spec.ts`

**Interfaces:**
- Consumes: `useBreadthHistory(window)` and existing current-session `useBreadth()`.
- Produces: range controls and three history charts with latest date/freshness, samples, and methodology text.

- [ ] Add E2E coverage for the history range selector, chart data states, and explanatory coverage counts.
- [ ] Run the test once to confirm the requested historical UI is missing.
- [ ] Implement mobile-responsive charts using existing chart conventions and semantic color tokens.
- [ ] Add English and Indonesian translations; ensure the page's existing namespaces include them.
- [ ] Run focused E2E and changed-file lint.

### Task 4: Full verification and staged release

**Files:**
- Modify: `docs/PROGRESS.md` with release evidence after merge.

- [ ] Run Engine/app typecheck, targeted and full unit suites, Engine E2E, production build, and Playwright desktop/mobile/tablet using a unique port.
- [ ] Commit and push feature branch; open PR to `develop` and wait for required CI.
- [ ] Verify dev and staging deployments, then promote via staging-to-main only with current owner approval (already given for this work session).
- [ ] Confirm Coolify deployment is healthy; verify production health/readiness, authenticated route protection, and API envelope for the new history route.
