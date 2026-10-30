# Investor Network Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone month-selectable KSEI ownership network module using stored snapshots only.

**Architecture:** Extend the ownership persistence port with distinct available months, serve a bounded network-and-change response from the Engine, proxy it through the authenticated Next.js BFF, and render an accessible graph plus complete searchable table.

**Tech Stack:** Bun, TypeScript, Drizzle/PostgreSQL, Zod, Next.js App Router, React Query, inline SVG, existing UI components.

**Spec:** `docs/superpowers/specs/2026-10-30-investor-network-replay-design.md`

## Global Constraints

- Do not add a database, table, migration, scraper, or data provider.
- Use only exact company-name matches already implemented by `ownershipNetworkFor`.
- Compare only the calendar-previous month; never bridge a gap.
- Preserve `HISTORICAL` freshness, point-in-time dates, references, and ≥1% incompleteness semantics.
- Keep ownership feature-flag behavior and authenticated app API access.
- No new runtime dependencies.

## Review Focus

- Missing month or no upload: return an undated/unavailable empty form; UI must not imply current data.
- Month gap: mark comparison unavailable and exclude deltas rather than compare to the previous available month.
- Mixed issuer comparison states: count only `COMPARED` sets and expose `NOT_ADJACENT`/`NO_PREVIOUS` counts.
- Ambiguous company matches: keep excluded and report their count.
- Large snapshot: bound graph nodes/edges for readability while table retains all holdings.

---

### Task 1: Month enumeration and bounded Engine contract

**Files:**
- Modify: `services/engine/src/ownership/store.ts`
- Modify: `services/engine/src/db/ownership.ts`
- Modify: `services/engine/src/serve/ownership.ts`
- Modify: `services/engine/src/http/app.ts`
- Modify: `src/server/schemas/ownership.ts`
- Modify: `services/engine/src/http/ownership.test.ts`

**Interfaces:**
- Add `OwnershipStore.months(): Promise<string[]>`, distinct `YYYY-MM` descending in both stores.
- Add `serveOwnershipNetwork(store, month?)` returning latest default month or selected stored month, `months`, snapshot counts, exact-match network, and month comparison summary.
- Add `GET /v1/ownership/network?month=YYYY-MM`, validated by the shared schema and gated by existing `ownershipNetwork` flag.

- [x] Add tests for latest default, explicit available month, invalid/unavailable month, one-month no-comparison, adjacent comparison and missing-month gap.
- [x] Implement distinct month reads and response derivation without schema or migration changes.
- [x] Run focused Engine tests and typecheck.
- [ ] Commit as `feat(ownership): serve month-selectable investor network`.

### Task 2: Authenticated app API and typed client

**Files:**
- Create: `src/app/api/ownership/network/route.ts`
- Modify: `src/server/market/idx-bei-source.ts`
- Modify: `src/server/market/source.ts`
- Modify: `src/lib/api/market.ts`
- Modify: `src/lib/api/hooks.ts`

**Interfaces:**
- Add shared `OwnershipNetworkReplay` schema/type and `marketApi.ownershipNetwork({month?})`.
- Preserve the app's authenticated, no-store market-route semantics.

- [x] Add route/source contract checks for default and selected month.
- [x] Implement parser, typed query hook and deterministic query key including selected month.
- [x] Run focused app tests and typecheck.
- [x] Commit as `feat(ownership): expose investor network replay API`.

### Task 3: Standalone discovery UI

**Files:**
- Create: `src/app/[locale]/(app)/discover/investor-network/page.tsx`
- Create: `src/app/[locale]/(app)/discover/investor-network/investor-network-view.tsx`
- Create: `src/app/[locale]/(app)/discover/investor-network/network-graph.tsx`
- Modify: `src/components/layout/nav-config.ts`
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/id.json`
- Modify: `src/app/[locale]/layout.tsx` only if a client translation namespace is needed.

- [x] Add a sidebar leaf outside the Whale/Ownership group and include it in mobile All Modules through the existing standalone-item rendering.
- [x] Render month selection from available snapshots, exact as-of/coverage stats, and adjacent comparison status/counts.
- [x] Render a bounded accessible SVG for exact corporate-holder edges and a searchable complete rows table; retain empty, stale, ambiguous and missing-comparison states.
- [x] Use localized month/date/numeric formatting and source-reference detail; add no external navigation to untrusted URLs.
- [x] Run focused component/E2E checks, app typecheck, lint on changed files, and production build check.
- [x] Commit as `feat(ownership): add investor network replay module`.

### Task 4: Promote and verify

**Files:** no additional source changes unless a gate fails.

- [ ] Open feature → `develop` PR; wait for required CI and deploy webhook; verify develop route and API behavior.
- [ ] Open `develop` → `staging` merge-commit PR; verify staging.
- [ ] Open `staging` → `main` merge-commit PR; after merge, wait for Coolify auto-deploy (do not manually deploy the app) and verify production health, auth redirect, and route availability.
- [ ] If Engine code changes, after main merge manually deploy the Engine once, then verify feature flag, API response, latest snapshot date and counts. Do not claim fresh data without production DB evidence.
- [ ] Record PRs, commits, CI outcomes, deployment IDs, and production snapshot coverage; keep personal/internal dataset wording unless written redistribution permission exists.
