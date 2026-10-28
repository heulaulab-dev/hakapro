# IDX-BEI Data Domains in HakaPro — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring IDX-BEI's useful official IDX datasets into HakaPro's existing engine and product surfaces, so existing analytics consume the same normalized, source-tagged IDX data.

**Architecture:** Extend the existing persistent curl_cffi worker with a finite IDX endpoint allowlist. Add one typed adapter and resumable job per dataset family, persist into existing tables wherever grains match, and use new normalized tables only for market-wide broker summaries and source-specific records with no compatible contract. Keep the existing APIs, source registry, scheduler, provenance, and pages as the only production system.

**Tech Stack:** TypeScript, Zod, Drizzle/PostgreSQL, Vitest, Python 3.10+, curl_cffi 0.16.3, JSON-lines worker.

**Spec:** `docs/superpowers/specs/2026-10-28-idx-bei-feature-parity-design.md`.

## Global Constraints

- IDX collection stays opt-in and uses `https://www.idx.co.id/primary` unless an authorized IDX prerelease host is explicitly configured.
- Worker endpoint paths are exact allowlisted IDX paths; never accept arbitrary URLs or path traversal.
- Reuse the existing scheduler, `job_cursors`, source registry, idempotent upserts, API auth, and HakaPro application routes.
- Keep market-wide broker daily totals distinct from per-stock broker summaries.
- Preserve source precedence; IDX fallback data cannot overwrite primary Yahoo/TradingView values.
- Use fixture-only automated tests; do not run tests against public IDX endpoints.
- Store announcement metadata and official attachment links only; do not fetch or host PDF contents in this delivery.
- Do not modify IDX WAF configuration, use CSSI-Lab, commit, push, or deploy outside the user's explicit release authorization.

## Review Focus

- A non-allowlisted path, malformed params, or path traversal never reaches the transport; test the worker boundary.
- Missing or stale dates do not advance a backfill cursor; test failures preserve resumability for each family.
- Stock daily prices preserve Yahoo precedence while filling missing rows and IDX foreign-flow provenance; test conflicting source rows.
- Broker daily rows retain their true date×broker grain and never appear as per-stock broker flow; test symbol/date boundaries.
- Pagination termination, duplicate pages, and empty pages do not skip records or loop indefinitely; test all paginated adapters.
- IDX numeric units and date fields remain explicit; percent metrics are not stored as whole percentages where HakaPro expects fractions.

---

### Task 1: Generalize the persistent transport with exact path allowlisting

**Files:**
- Modify: `services/engine/python/idx_transport.py`
- Test: `services/engine/python/tests/test_idx_transport.py`
- Modify: `services/engine/python/idx_curl_worker.py`
- Test: `services/engine/python/tests/fixtures/idx-echo-worker.py`
- Modify: `services/engine/src/sources/idx-curl-cffi.ts`
- Test: `services/engine/src/sources/idx-curl-cffi.test.ts`
- Modify: `services/engine/src/sources/idx-primary.ts`
- Test: `services/engine/src/sources/idx-primary.test.ts`

**Interfaces:**
- Python `IDXTransportClient.fetch_json(path: str, params: dict[str, str | int | float | bool]) -> dict[str, Any]` accepts only exact paths for the verified stock, broker, index, company profile/detail, ratios, corporate actions, exchange-member, news, and announcement endpoints.
- TypeScript `IdxJsonTransport.fetchJson(path: string, params: Record<string, string | number | boolean>, signal?: AbortSignal): Promise<IdxFetchResult>` uses the same JSON-lines worker and session. `fetchIndexSummary` remains source-compatible and delegates through the existing index operation.

- [x] Write tests for an allowed request path, a rejected path traversal/unknown path, parameter forwarding, and repeated requests over one worker session.
- [x] Run Python unit tests and the TypeScript bridge test; observe the new allowed-path tests fail first.
- [x] Implement the path allowlist and `request` JSON-lines operation while retaining bounded timeout/retry/session close behavior.
- [x] Run Python transport and TypeScript bridge/index fixture tests (Python 7/7 in the current verification).

### Task 2: Ingest historical stock summaries into existing daily prices

**Files:**
- Create: `services/engine/src/sources/idx-stock-summary.ts`
- Test: `services/engine/src/sources/idx-stock-summary.test.ts`
- Create: `services/engine/src/jobs/idx-stock-backfill.ts`
- Test: `services/engine/src/jobs/idx-stock-backfill.test.ts`
- Modify: `services/engine/src/db/ingest.ts`
- Modify: `services/engine/src/config.ts`
- Test: `services/engine/src/config.test.ts`
- Modify: `services/engine/src/engine.ts`
- Fixture: `services/engine/src/sources/fixtures/idx-stock-summary.2026-08-07.json`

**Interfaces:**
- `parseIdxStockSummary(body: unknown, requestedDate: string): { rows: DailyUpsert[]; rejected: IdxStockReject[] }` validates the DataTables envelope, matching trade date, symbol, positive close, and nonnegative volume/value/frequency.
- `IdxStockTransport.fetchStockSummary(date: string): Promise<IdxFetchResult>` requests `GetStockSummary?date=YYYYMMDD&start=0&length=9999`.
- The job reuses `backfillJob`, writes through `upsertDaily` with `{ primary: false, value: "fill", foreign: true }`, and advances only after a successful valid response.

- [x] Add a fixture-based parser test asserting OHLCV, foreign buy/sell shares, valid-date rules, and rejected invalid rows.
- [x] Add a persistence test proving IDX fills absent data, does not overwrite Yahoo OHLC, and records independent foreign-flow provenance.
- [x] Implement request construction, parser, injected transport adapter, and resumable job.
- [x] Register config/source/job and run parser, job, ingest, and config tests.

### Task 3: Store and serve broker activity and member directory

**Files:**
- Modify: `services/engine/db/schema.ts`
- Create: `services/engine/db/migrations/00xx_idx_broker_daily.sql`
- Create: `services/engine/src/db/idx-broker.ts`
- Test: `services/engine/src/db/idx-broker.test.ts`
- Create: `services/engine/src/sources/idx-broker-summary.ts`
- Test: `services/engine/src/sources/idx-broker-summary.test.ts`
- Create: `services/engine/src/jobs/idx-broker-backfill.ts`
- Test: `services/engine/src/jobs/idx-broker-backfill.test.ts`
- Modify: `services/engine/src/http/app.ts`
- Modify: `services/engine/src/serve/market-info.ts`
- Modify: `src/server/schemas/idx-bei.ts`
- Modify: `src/server/market/idx-bei-source.ts`
- Fixture: `services/engine/src/sources/fixtures/idx-broker-summary.2026-08-07.json`

**Interfaces:**
- Table grain is `(date, broker_code)` with `firm_name`, `volume`, `value`, `frequency`, and source provenance; the primary key makes replay idempotent.
- `parseIdxBrokerSummary(body, requestedDate)` validates the DataTables envelope and one row per broker.
- `/v1/brokers/market-summary?from&to&limit` returns daily broker totals and coverage; existing per-stock broker APIs remain unchanged.

- [x] Test parser normalization, date mismatch, empty pages, and duplicate brokers.
- [x] Test store upsert idempotence and served response ordering/range limits.
- [x] Add the migration, source, checkpointed backfill, route schema, and engine registration.
- [x] Run migration/schema, parser, store, job, and route tests.
- [x] Add the `GetBrokerSearch` member-directory snapshot as a separate idempotent table, scheduled refresh, engine API, and HakaPro data-source/BFF capability. Incomplete directories are rejected; they never overwrite the last complete snapshot.

### Task 4: Add issuer directory/detail and IDX ratio ingestion

**Files:**
- Create: `services/engine/src/sources/idx-company.ts`
- Test: `services/engine/src/sources/idx-company.test.ts`
- Create: `services/engine/src/jobs/idx-company.ts`
- Test: `services/engine/src/jobs/idx-company.test.ts`
- Create: `services/engine/src/sources/idx-ratios.ts`
- Test: `services/engine/src/sources/idx-ratios.test.ts`
- Create: `services/engine/src/jobs/idx-ratios.ts`
- Test: `services/engine/src/jobs/idx-ratios.test.ts`
- Modify: existing `securities` and `stock_ratios` mappings only where compatible; create a source-period ratio table and migration for IDX values that cannot fit the current latest-ratio contract.
- Fixture: official IDX-BEI `allCompanies.json`, one `GetCompanyProfilesDetail` response, and one financial-ratio page reduced to representative records.

**Interfaces:**
- Company list parser maps `KodeEmiten`, `NamaEmiten`, `Sektor`, `SubSektor`, `Industri`, `SubIndustri`, `PapanPencatatan`, and listing date into existing `securities`; only a complete list response may deactivate missing symbols.
- Company-detail parser validates `Profiles` and stores source-owned profile fields in an idempotent issuer snapshot keyed by `(symbol, language)`; no guessed mapping into ownership records.
- Ratio parser retains `fsDate`, reported period, audit opinion, sharia flag, numeric values, and raw metric keys. Percent values are normalized only for existing fraction-valued `stock_ratios`; the source-period table retains reported units.

- [x] Add fixture parser tests for company list, detail, ratio periods, null metrics, and percentage normalization.
- [x] Add job tests for pagination/detail cursors, retry-safe checkpointing, and complete-universe-only deactivation.
- [x] Add the minimal migration/storage needed for issuer snapshots and source-period ratios.
- [x] Register source/jobs and expose the supported fields through existing profile/fundamentals API consumers.
- [x] Run focused parser, migration, job, and API tests.

### Task 5: Ingest corporate actions, market news, and announcement metadata

**Files:**
- Create: `services/engine/src/sources/idx-disclosures.ts`
- Test: `services/engine/src/sources/idx-disclosures.test.ts`
- Create: `services/engine/src/jobs/idx-disclosures.ts`
- Test: `services/engine/src/jobs/idx-disclosures.test.ts`
- Modify: `services/engine/src/db/ingest.ts` and `services/engine/src/db/market-info.ts` for idempotent source-owned writes.
- Modify: `services/engine/src/http/app.ts`, `services/engine/src/serve/market-info.ts`, `src/server/schemas/idx-bei.ts`, and existing BFF routes only as required.
- Fixtures: `corporateActions.json`, one `GetNewsSearch` page, and `announcements_page1.json` from the MIT reference repository, minimized to representative records.

**Interfaces:**
- Corporate actions map all 15 IDX `caType` values to stable action types while preserving the original category; persist via the existing `corporate_actions` grain and natural key.
- News maps IDX item IDs, titles, summaries, and official links into `news_items`, preserving current URL/title dedupe and retention behavior.
- Announcements map stable IDX `Id`, normalized code, publish timestamp, title, and validated official attachment URL into `announcements`; never download attachment bodies.
- Each pagination job records page/checkpoint state and does not mark an incomplete page as complete.

- [x] Add fixture tests for category mapping, date/code trimming, news deduplication fields, and official HTTPS attachment URLs.
- [x] Add job tests for pagination resume and repeated-run idempotence.
- [x] Implement parsers, source-owned writes, routes, and wire existing news/actions/disclosure screens.
- [x] Run parser, job, store, and API tests.

### Task 6: Capability map, full verification, and production rollout

**Files:**
- Update: `docs/superpowers/specs/2026-10-28-idx-bei-feature-parity-design.md`
- Update: `docs/research/idx-data-engine-crawler.md`
- Runtime: existing Coolify HakaPro engine and app services.

- [x] Complete a capability map from IDX-BEI analytics (signals, dividend/trap analysis, backtests, ownership/UBO/drift, RRG) to existing HakaPro screens; document only genuine gaps and implement missing work in those existing routes.
- [ ] Run all Python transport tests, all IDX fixture/parser/job/store/API tests, `bun run typecheck`, and the repository verification command; resolve failures before release.
- [ ] Promote the reviewed branch through develop and staging; verify migrations, sources, scheduled jobs, and app endpoints before production.
- [ ] Deploy through Coolify using the user's previously authorized release path, keep IDX collection enabled only for the configured official endpoint, and verify persisted rows, freshness, source provenance, and user-facing data for each completed domain.
- [ ] Trigger the IDX index backfill revision replay, verify all five missing sectors have at least 34 dates aligned to COMPOSITE, and confirm daily and weekly RRG render in production.
- [ ] Report production coverage and any upstream fields that cannot be mapped without inventing data.
