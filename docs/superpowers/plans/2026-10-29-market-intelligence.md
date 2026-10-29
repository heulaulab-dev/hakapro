# Market Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship Catalyst Radar, Market Breadth & Regime, and Ownership Network Explorer using existing HakaPro data.

**Architecture:** Add small pure derivation modules and typed engine routes, then app adapters and a unified Discover UI. Each slice is flag-gated and preserves source/as-of/freshness metadata.

**Tech Stack:** Bun/TypeScript engine, Next.js App Router, Zod contracts, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-29-market-intelligence-design.md`

## Global Constraints

- Do not add a datasource or claim coverage not present in the current engine.
- Default all three engine flags to off; preserve honest unavailable states.
- Keep KSEI ownership separate from IDX-BEI disclosures.
- Do not enable TradingView logos or strategy scans.
- Preserve reduced-motion and neutral depth-token rules.

## Review Focus

- Stale snapshots must become `UNAVAILABLE`, not current-looking cards — route tests.
- Missing one dataset must not suppress other catalyst events — composer tests.
- Exact ownership matching must reject fuzzy or ambiguous names — network tests.
- Delayed breadth must expose timestamp and source — breadth tests.
- Flag-off deployments must remain backward-compatible — config/route tests.

### Task 1: Contracts and flags

**Files:** `src/server/schemas/idx-bei.ts`, engine config, new tests.

- [ ] Add Zod contracts for catalyst events, breadth, and ownership network.
- [ ] Add three default-off engine flags and route unavailable metadata.
- [ ] Run targeted contract/config tests.

### Task 2: Catalyst derivation and route

**Files:** `services/engine/src/serve/catalysts.ts`, `services/engine/src/http/app.ts`, tests.

- [ ] Write failing normalization/composition tests.
- [ ] Implement bounded newest-first catalyst composition with source and freshness.
- [ ] Expose `GET /v1/stocks/{symbol}/catalysts` behind its flag.
- [ ] Run engine unit and route tests.

### Task 3: Breadth derivation and route

**Files:** `services/engine/src/serve/breadth.ts`, `services/engine/src/http/app.ts`, tests.

- [ ] Write failing threshold/staleness tests.
- [ ] Implement conservative breadth counts, sector leadership, and regime label.
- [ ] Expose `GET /v1/breadth` behind its flag.
- [ ] Run engine tests.

### Task 4: Ownership network

**Files:** `services/engine/src/serve/ownership.ts`, ownership schemas/tests.

- [ ] Write failing exact-match/ambiguity tests.
- [ ] Implement graph nodes/edges from the existing KSEI snapshot service.
- [ ] Add the `network` field without changing existing holder semantics.
- [ ] Run ownership tests.

### Task 5: App adapters and UI

**Files:** app API clients, Discover Market Intelligence route, stock Catalyst card, translations, Playwright tests.

- [ ] Add typed adapters and flag-off unavailable states.
- [ ] Build responsive cards/tabs using existing UI primitives.
- [ ] Add fixture tests for all three experiences and stale/empty states.
- [ ] Run typecheck, lint, Vitest, and desktop/mobile/tablet Playwright.

### Task 6: Release verification

- [ ] Run full build and engine E2E.
- [ ] Commit, push feature branch, open PR, and promote through develop/staging/main with owner-approved production release.
- [ ] Verify live route metadata and production health.
