# Market Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Market Replay page that synchronizes issuer race, breadth, and sector performance on one historical session slider.

**Architecture:** The client page consumes the existing issuer-race, breadth-history, and indices-history APIs. A pure helper resolves exact-date values and baseline-relative index returns; UI controls move through issuer-race frames without forward-filling missing observations.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, next-intl, existing TanStack Query hooks, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-30-market-replay-design.md`

## Global Constraints

- Keep all facts sourced from persisted Engine responses and label the session date and freshness.
- Never carry data forward to cover a missing selected session.
- Keep issuer universe coverage visible and don't imply complete market coverage.
- Respect `prefers-reduced-motion`; keep manual session navigation available.
- Do not add a data provider, migration, or dependency.

## Review Focus

- Missing observations on the selected session: display unavailable; test exact-date behavior.
- Missing sector or IHSG baseline: display unavailable; test missing-baseline behavior.
- Short production history: 1M remains the default and replay supports the frames actually returned; test a short timeline.
- Reduced-motion preference: autoplay is unavailable while manual controls remain; cover in Playwright.
- Partial race universe: expose priced / baseline / active counts and truncation; assert in UI test.

---

### Task 1: Replay date alignment helper

**Files:**
- Create: `src/lib/market-replay.ts`
- Test: `src/lib/market-replay.test.ts`

**Interfaces:**
- Consumes: `IssuerRace`, `BreadthHistory`, `IndicesHistory` data shapes.
- Produces: exact-date breadth lookup, index lookup, and nullable percentage return from a shared baseline.

- [x] Write tests for exact-date-only breadth/index resolution, missing values, and normalized index return.
- [x] Run the focused test and observe the expected failure.
- [x] Implement the typed pure helpers.
- [x] Re-run focused tests.

### Task 2: Market Replay route and navigation

**Files:**
- Create: `src/app/[locale]/(app)/discover/market-replay/page.tsx`
- Create: `src/app/[locale]/(app)/discover/market-replay/market-replay-view.tsx`
- Modify: `src/components/layout/nav-config.ts`
- Modify: `src/app/[locale]/layout.tsx`
- Modify: `src/i18n/messages/en.json`, `src/i18n/messages/id.json`
- Test: `tests/e2e/market-replay.spec.ts`

**Interfaces:**
- Consumes: `useIssuerRace`, `useBreadthHistory`, `useIndicesHistory`, and Task 1 helpers.
- Produces: authenticated `/discover/market-replay` page reachable from desktop and mobile Pulse navigation.

- [x] Add a Playwright test with fixture API responses for navigation, timeline changes, synced date labels, coverage, and reduced-motion controls.
- [x] Run the focused E2E test and observe the expected failure.
- [x] Add the page, compact stat cards, issuer race, sector-vs-IHSG comparison, slider/playback, and coverage/freshness text.
- [x] Add translated navigation and page strings to client namespace hydration.
- [x] Re-run focused E2E tests and typecheck/lint.

### Task 3: Full verification

**Files:** changed files above.

- [x] Run focused Vitest and Playwright desktop/mobile.
- [x] Run `bun run verify` (includes typecheck, lint, full Vitest, production guards, server-boundary checks, and production build).
- [x] Review `git diff --check`, the final diff, and source freshness behavior.
- [ ] Commit with a clear `feat(market): add synchronized market replay` message.


## Verification results

- `bun run verify`: passed; typecheck, lint, 1,127 unit tests, production guards, server-boundary checks, and production build.
- `PLAYWRIGHT_PORT=3498 bunx playwright test tests/e2e/market-replay.spec.ts --project=desktop --project=mobile`: 2 passed, 2 skipped (each test is scoped to its matching project).
- `bunx vitest run src/lib/market-replay.test.ts`: 3 passed.
- `npx react-doctor@latest --verbose --scope changed`: score 100/100, no issues.
- No Engine code, migration, scraper, or datasource was added; feature uses existing Engine API responses.
