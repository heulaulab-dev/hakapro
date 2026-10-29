# Broker Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone, coverage-aware market-wide broker participation explorer using the Engine's existing IDX daily broker summary.

**Architecture:** Extend the Engine response additively with reference EOD session coverage and per-date broker row counts. Consume it through the existing authenticated BFF, derive reported-value share and rankings in a focused client feature, and expose a standalone route in the shared navigation.

**Tech Stack:** Next.js 16 App Router, Bun, TypeScript, Zod, TanStack Query, Recharts, Vitest, existing HakaPro UI kit.

**Spec:** `docs/superpowers/specs/2026-10-30-broker-activity-design.md`

## Global Constraints

- Preserve the market-wide date×broker source grain; do not infer ticker, side, or investor identity.
- Shares and concentration are based only on reported broker-summary value.
- Expected session dates come from stored Engine EOD rows and are labeled as such.
- Missing dates remain gaps; stale/unavailable metadata remains visible.
- Use no new scraper, database migration, dependency, or public unauthenticated route.
- Keep the Engine extension backward-compatible at the application schema boundary.

## Review Focus

- Zero or null reported-value denominator: no share or concentration values; test it.
- Missing broker-summary session among EOD dates: count as missing coverage and preserve a chart gap; test it.
- Exactly 100 brokers in one session: treat concentration as capped/partial and hide concentration for that session; test it.
- Old Engine response without the new optional coverage block: still parses and page shows explicitly unknown coverage; test it.
- Stale or unavailable Engine envelope: show stale/unavailable state, never current; test metadata rendering.

---

### Task 1: Add Engine session coverage to the market broker response

**Files:**
- Modify: `services/engine/src/serve/market-info.ts`
- Modify: `services/engine/src/serve/store.ts` only if the existing `sessionDates` signature needs test-store support
- Modify: `src/server/schemas/idx-bei.ts`
- Test: `services/engine/src/serve/market-info.test.ts`
- Test: `services/engine/src/http/app.test.ts`

**Interfaces:**
- Consumes: `MarketStore.sessionDates(endDate, count)` and existing `brokerDailySummaryBetween(from, to)`.
- Produces: `marketBrokerSummarySchema` with optional `coverage: { expectedSessions, reportedSessions, missingDates, brokerCounts: [{ date, count }] }`.

- [x] Add tests for missing EOD-referenced sessions, row counts, and zero-summary behavior.
- [x] Run the focused Engine tests and confirm the new tests fail on the old response.
- [x] Extend `serveMarketBrokerSummary` to compare grouped broker dates with up to 300 EOD session dates in range; keep missing dates explicit and preserve response freshness.
- [x] Make the app schema's new coverage block optional for older deployed Engine versions.
- [x] Run focused Engine tests and `bun run engine:test:e2e` (47 passed).

### Task 2: Add broker activity derivations and page

**Files:**
- Modify: `src/lib/api/market.ts`, `src/lib/api/hooks.ts`, `src/lib/query/keys.ts`
- Create: `src/lib/broker-activity.ts` and `src/lib/broker-activity.test.ts`
- Create: `src/app/[locale]/(app)/discover/broker-activity/page.tsx`
- Create: `src/app/[locale]/(app)/discover/broker-activity/broker-activity-view.tsx`
- Create: `src/app/[locale]/(app)/discover/broker-activity/broker-activity-view.test.tsx`
- Modify: `src/i18n/messages/en.json`, `src/i18n/messages/id.json`

**Interfaces:**
- Consumes: `marketApi.marketBrokerSummary({ from, to, limit: 100 })` and envelope freshness metadata.
- Produces: pure derivations for daily reported-value shares, concentration, six-broker race series, and ranking rows.

- [x] Add derivation tests for share math, stable rankings, missing dates, null values, zero denominators, and the 100-row cap.
- [x] Implement pure derivation helpers and run their focused tests.
- [x] Add typed query key/hook with abort signal and a 366-day API bound.
- [x] Build the page with range control, freshness and session-coverage summary, race, concentration trend, latest ranking/table, empty/error/loading states, and methodology.
- [x] Add English and Indonesian translations; ensure chart data has an equivalent table/accessible description.
- [x] Run focused app tests, full verification, and ESLint.

### Task 3: Add standalone navigation and browser coverage

**Files:**
- Modify: `src/components/layout/nav-config.ts`
- Modify: `src/components/layout/mobile-nav.tsx` only if standalone modules are not already included dynamically
- Modify: `tests/e2e/navigation.spec.ts` or the existing discovery E2E spec

**Interfaces:**
- Consumes: the new page route and existing standalone navigation pattern used by the 1% Screener.
- Produces: `brokerActivity` nav key and `Broker Activity` top-level entry, not a child of `Ownership`.

- [x] Add a navigation assertion proving Broker Activity is top-level and the Ownership group remains unchanged.
- [x] Add route test coverage for page metadata/navigation and a mobile menu assertion.
- [x] Run focused desktop and mobile Playwright projects with mocked market API data.

### Task 4: Verify, commit, and release

**Files:**
- Update: `docs/PROGRESS.md` only if the existing format tracks this delivered module
- Include: research, spec, and plan docs

- [x] Run `bun run typecheck`, changed-file ESLint, focused tests, `bun run verify`, and Engine E2E.
- [x] Run `git diff --check` and inspect the complete diff for source-grain, freshness, and i18n issues.
- [ ] Commit the feature and open PR to `develop`; wait for required CI and merge with a merge commit.
- [ ] Verify the automatic dev deployment and health.
- [ ] Promote `develop`→`staging`, verify staging deployment and health, then promote `staging`→`main` under the owner's existing release authorization.
- [ ] After app code reaches `main`, deploy Engine manually only if its image does not already contain the additive response; do not manually redeploy the web application.
- [ ] Verify production app/Engine health and the protected route behavior; do not describe unauthenticated API protection as chart-render evidence.
- [ ] Record terminal deployment SHAs and CI/deployment results in the final report.
