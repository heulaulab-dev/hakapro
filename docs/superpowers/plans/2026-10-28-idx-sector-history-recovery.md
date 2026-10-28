# IDX Sector History Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-fetch and expose all 11 IDX-IC sector indices through HakaPro's existing backfill, index store, history API, and RRG, including `IDXNONCYC`, `IDXCYCLIC`, `IDXTECHNO`, `IDXINFRA`, and `IDXTRANS`.

**Architecture:** Keep the existing `idx-index-backfill` job, `index_daily` table, `/v1/indices/history` API, and RRG. Add an IDX-only cursor revision so a deliberate deployment can replay the existing date range without deleting rows or touching other job cursors. Verify all five codes with the 45-row fixture at each data boundary, and replace the false “no legitimate source” UI statement with actual missing-history and RRG readiness language.

**Tech Stack:** TypeScript, Zod, Drizzle, Vitest, Next.js, `curl_cffi` worker already in HakaPro.

**Spec:** `docs/superpowers/specs/2026-10-28-idx-bei-feature-parity-design.md` (first vertical slice only; later IDX-BEI domains require their own implementation plans).

## Global Constraints

- Use the existing IDX source, scheduler, cursor store, `index_daily`, and APIs; do not create a parallel ingestion system.
- Keep IDX transport configured for the official IDX endpoint and existing bounded retry policy.
- Preserve source provenance and existing primary-source precedence; do not delete or fabricate observations.
- Keep fixture and transport tests isolated from live IDX requests.
- Do not modify production WAF configuration or use CSSI-Lab.
- Do not commit, push, or deploy without the user's approval.

## Review Focus

- Cursor replay must restart only when the IDX revision changes; other date backfills must keep their existing cursors. Test same-revision resume and changed-revision restart.
- A valid sector row must survive parsing and persistence; test all five named codes and the full 45-row fixture.
- A missing sector must not be called unsupported; test history API returns all five stored series and replace stale English and Indonesian copy.
- RRG readiness depends on 34 aligned daily observations, not merely one stored close; retain and verify the existing insufficient-history threshold.
- An unavailable request must not advance the replay cursor; retain the existing unavailable-job test.

---

### Task 1: Add a scoped IDX backfill replay revision

**Files:**
- Modify: `services/engine/src/schedule/backfill.ts`
- Test: `services/engine/src/schedule/backfill.test.ts`
- Modify: `services/engine/src/jobs/idx-index-backfill.ts`
- Test: `services/engine/src/jobs/idx-index-backfill.test.ts`
- Modify: `services/engine/src/config.ts`
- Test: `services/engine/src/config.test.ts`
- Modify: `services/engine/src/engine.ts`

**Interfaces:**
- `BackfillOptions` gains optional `cursorRevision?: string`. When omitted, preserve the existing cursor key behavior. When supplied, store and compare `updatedFor` as `${from}:${cursorRevision}`; a changed key starts at `from` and only that job's cursor is reset by normal cursor writes.
- `IdxIndexBackfillOptions` accepts `cursorRevision?: string` and passes it to `backfillJob`.
- Config exposes `idxPrimary.backfillRevision`, sourced from `ENGINE_IDX_PRIMARY_BACKFILL_REVISION`, with default `3` for this replay after the earlier revision 2 cursor. `engine.ts` passes this to the IDX job.

- [ ] **Step 1: Write cursor tests** for a date backfill that resumes when the revision is unchanged and starts from the configured `from` date when the revision changes; also assert a job without `cursorRevision` retains legacy behavior.
- [ ] **Step 2: Run the focused scheduler test**

Run: `bun run test -- services/engine/src/schedule/backfill.test.ts`
Expected: the new revision test fails before the implementation.

- [ ] **Step 3: Implement the optional cursor revision** in `backfill.ts`; pass it through the IDX job and engine config only. Do not change other jobs' options.
- [ ] **Step 4: Add config assertions** for the default revision and an explicitly configured revision in `config.test.ts`.
- [ ] **Step 5: Run focused scheduler, IDX job, and config tests**

Run: `bun run test -- services/engine/src/schedule/backfill.test.ts services/engine/src/jobs/idx-index-backfill.test.ts services/engine/src/config.test.ts`
Expected: PASS; an unavailable IDX request still leaves its cursor unchanged.

### Task 2: Prove all five sector codes survive the real IDX fixture path

**Files:**
- Test: `services/engine/src/sources/idx-primary-live-fixture.test.ts`
- Test: `services/engine/src/jobs/idx-index-backfill.test.ts`

**Interfaces:**
- Use the existing 45-row fixture `services/engine/src/sources/idx-index-summary.2026-10-26.fixture.json` and existing `parseIdxIndexSummary` / `idxIndexBackfillJob` interfaces. Do not add a second fixture or loosen validation.

- [ ] **Step 1: Pin the parser contract** by asserting the parsed rows contain `IDXNONCYC`, `IDXCYCLIC`, `IDXTECHNO`, `IDXINFRA`, and `IDXTRANS`, each with a positive close and requested date.
- [ ] **Step 2: Pin persistence behavior** by feeding the 45-row fixture through the backfill job and asserting the persist callback receives all five codes and all 45 valid rows.
- [ ] **Step 3: Run the fixture and job tests**

Run: `bun run test -- services/engine/src/sources/idx-primary-live-fixture.test.ts services/engine/src/jobs/idx-index-backfill.test.ts`
Expected: PASS with no live network access.

### Task 3: Verify history serving and correct the RRG coverage explanation

**Files:**
- Create: `services/engine/src/serve/market-info.test.ts`
- Modify: `src/lib/api/market.ts`
- Test: `src/lib/api/market.test.ts`
- Modify: `src/app/[locale]/(app)/discover/rotation/rotation-view.tsx`
- Modify: `src/i18n/messages/en.json`
- Modify: `src/i18n/messages/id.json`
- Test: `src/lib/sector-rotation.test.ts`

**Interfaces:**
- Exercise existing `serveIndicesHistory(store, from, to, codes, now)` with an injected `MarketStore` stub containing five sector rows; verify all five remain in the response and each has a coverage entry.
- Preserve the engine coverage contract in the client-side `indicesHistorySchema`; show stored observation counts and last dates for all 11 sectors, defaulting absent codes to zero.
- Keep `minObservations()` unchanged: daily RRG requires 34 aligned observations. Missing raw index history and insufficient aligned RRG history are separate states.

- [ ] **Step 1: Write a history-serving test** that supplies all five named sector rows and asserts `/v1` serving preserves their code, date, and close in each series.
- [ ] **Step 2: Run the focused serving test**

Run: `bun run test -- services/engine/src/serve/market-info.test.ts`
Expected: PASS for the existing all-series path; the test guards against future accidental code filtering.

- [ ] **Step 3: Replace the stale sector copy** in English and Indonesian with language that says which sector histories have no observations yet, without asserting that IDX has no valid source. Keep the 34-observation progress statement and clarify that one fetched observation does not activate daily RRG.
- [ ] **Step 4: Preserve coverage in the client schema** and render a source-history status table for all 11 sector codes with observations and latest date; use zero/“not yet fetched” when a code is absent.
- [ ] **Step 5: Preserve the RRG readiness threshold** with a named assertion that `minObservations(RRG_PARAM_DEFAULTS.daily) === 34`.
- [ ] **Step 6: Run focused app and engine checks**

Run: `bun run test -- src/lib/api/market.test.ts src/lib/sector-rotation.test.ts && bun run test -- services/engine/src/serve/market-info.test.ts`
Expected: PASS; RRG methodology remains unchanged, client API retains coverage, and API series and UI copy agree on the distinction between absent history and insufficient aligned observations.

### Task 4: Replay IDX history and verify production coverage

**Files:**
- Runtime config: existing Coolify engine service environment, `ENGINE_IDX_PRIMARY_BACKFILL_REVISION`
- Verification: existing engine job logs and `/v1/indices/history`

**Interfaces:**
- A revision change is the operator-controlled replay trigger. On deployment, the existing IDX backfill restarts at `BACKFILL_START` and proceeds in five-trading-day batches. It retains all stored rows and continues to respect IDX transport retries, source precedence, and the scheduler's night window.

- [ ] **Step 1: Promote the reviewed code through develop and staging** using the established release process; verify worker startup, job registration, and successful fixture/CI gates before production.
- [ ] **Step 2: Deploy the engine with `ENGINE_IDX_PRIMARY_BACKFILL_REVISION=3` (the default)** and preserve all existing env values.
- [ ] **Step 3: Verify replay progresses** from `2020-01-01` in `idx-index-backfill` logs without cursor advancement on failed requests; check that existing index rows remain available throughout.
- [ ] **Step 4: Query production `/v1/indices/history`** after at least 34 shared trading dates have been fetched; verify all five sector series have 34 or more dates aligned with `COMPOSITE` and the RRG page renders them.
- [ ] **Step 5: Report actual coverage** per code (count, first date, last date, latest date, and flags); do not call RRG production-ready until all five series meet the 34-date daily threshold.

## Plan Scope

This plan recovers the five missing IDX-IC sector histories as the first native-integration slice. Separate plans will cover generalizing the IDX transport and the remaining IDX-BEI stock, broker, issuer, financial-ratio, actions, and disclosure domains described in the design document.
