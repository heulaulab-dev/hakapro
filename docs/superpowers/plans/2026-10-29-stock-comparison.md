# Stock Comparison Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a source-backed `/discover/compare` workspace matching the reference comparison experience for two to four IDX stocks.

**Architecture:** A pure helper normalizes daily closes to 100 and summarizes returns. A client view owns URL-backed selection/range state and composes existing history, price, profile, and analysis hooks. Existing chart/panel primitives render the responsive result.

**Tech Stack:** Next.js App Router, React, TanStack Query, Zod, Recharts, next-intl, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-stock-comparison-design.md`

## Global Constraints

- Use existing market APIs and schemas; do not invent unavailable values or add a parallel Engine pipeline.
- Maximum four symbols; IDX symbols only through existing search/market validation behavior.
- Preserve freshness and source dates in the UI.
- Keep public ticker logos disabled; monograms remain the fallback.
- Follow existing UI components and Next.js version guidance in `node_modules/next/dist/docs/`.

## Review Focus

- Empty, duplicate, malformed, and over-limit URL symbols are normalized safely.
- A missing/short history series renders an honest unavailable state rather than a misleading zero line.
- Date range changes preserve selected symbols and do not flash data from another symbol.
- Partial analysis/profile failures leave the chart usable.
- Mobile table and ticker controls remain keyboard accessible and horizontally scrollable.

### Task 1: Pure comparison normalization

**Files:**
- Create: `src/lib/comparison.ts`
- Test: `src/lib/comparison.test.ts`

**Interfaces:**
- Produces `normalizeComparisonSeries(points: Array<{date: string; close: number}>, minimumPoints?: number): { points: Array<{date: string; value: number}>; returnPercent: number | null }`.
- Produces `normalizeComparisonSymbols(value: string | null, max?: number): string[]`.

- [ ] Write failing tests for baseline 100 normalization, signed return, insufficient data, duplicate symbols, and max-four truncation.
- [ ] Implement the pure helpers with deterministic sorting and no UI dependencies.
- [ ] Run `bunx vitest run src/lib/comparison.test.ts`.
- [ ] Commit `feat: add comparison normalization helpers`.

### Task 2: API query support

**Files:**
- Modify: `src/lib/query/keys.ts`
- Modify: `src/lib/api/hooks.ts`

**Interfaces:**
- Add `useComparisonHistory(symbol, range)` as a thin wrapper around existing `useHistory` with daily frame and range bounds.

- [ ] Add a stable query key for comparison history ranges.
- [ ] Add the hook with same-symbol placeholder protection.
- [ ] Run typecheck and the comparison unit tests.
- [ ] Commit `feat: add comparison history query support`.

### Task 3: Comparison workspace route and UI

**Files:**
- Create: `src/app/[locale]/(app)/discover/compare/page.tsx`
- Create: `src/app/[locale]/(app)/discover/compare/compare-view.tsx`
- Modify: `src/components/layout/nav-config.ts`
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/id.json`
- Modify: `src/app/[locale]/layout.tsx` if a new client namespace is required

**Interfaces:**
- Route renders `CompareView` with URL parameters `symbols` and `range`.
- `CompareView` renders ticker chips, add-symbol search, range controls, normalized `MultiLineChart`, and a comparison table with latest close, period return, daily move, RSI, foreign net, and score.

- [ ] Add route metadata/layout conventions matching other discover pages.
- [ ] Implement URL state with `router.replace`, preserving locale and clamping four symbols.
- [ ] Compose existing hooks; use `DataState` and explicit unavailable/partial states.
- [ ] Add nav entry and localized copy in both languages; register any namespace.
- [ ] Run targeted typecheck/lint and build check.
- [ ] Commit `feat: add source-backed stock comparison workspace`.

### Task 4: Verification

**Files:** None beyond prior tasks.

- [ ] Run `bunx vitest run src/lib/comparison.test.ts`.
- [ ] Run `bun run typecheck` and `bun run lint`.
- [ ] Run `bun run build:check`.
- [ ] Inspect git diff for unrelated changes and report route/data behavior.
