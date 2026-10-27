# IDX Market-Data Crawler & Historical Backfill — Analysis, Gap Assessment & Implementation

_Historical assessment snapshot: research + bounded implementation. No commit / push / deploy. No data fabricated. 2026-10-27. See the [follow-up transport study](idx-bei-transport-study.md) for the authorized prerelease red-team implementation and updated findings._

The assessment below records the state and access boundary at the time it was written. The project owner later confirmed that the IDX prerelease target is under their red-team control. The follow-up implements an opt-in `curl_cffi` transport for that authorized target; it remains disabled by default and does not change this historical snapshot.

This document covers the 10-phase "Data Engine — IDX Market Data Crawler & Historical Backfill" brief.
It reports what the real `idx-bei` project does, what the HakaPro Data Engine already does, which of the brief's
capabilities are legitimately feasible under the stated constraints, what was implemented, and what remains blocked
by data access / licensing.

---

## 1. `idx-bei` architecture & capability analysis (Phase 1)

Repository inspected: **[`nichsedge/idx-bei`](https://github.com/nichsedge/idx-bei)** (the top hit for "idx-bei"; MIT
licensed; README disclaimer: _"For educational and research purposes only. Comply with IDX terms of service."_).
Related projects reviewed for corroboration: [`antonizer/IDX-Scrapper`](https://github.com/antonizer/IDX-Scrapper)
(scrapes `idx.co.id`; README explicitly warns _"prohibited from using the information … for commercial purposes
without written permission"_) and [`fzn0x/idx`](https://github.com/fzn0x/idx/wiki) (IHSG CLI/MCP over Yahoo + IDX
summaries).

| Dimension | `idx-bei` finding |
|---|---|
| Language / layout | Python 3.13 (`src/` package) **and** a Go 1.24 sync engine; DuckDB + Parquet storage, Neo4j graph ingest. |
| Data source | **IDX's own site** (`idx.co.id`) JSON endpoints: `GetStockSummary`, `GetBrokerSummary`, **`GetIndexSummary`**, `GetCompanyProfiles(Detail)`, `GetApiDataPaginated`, `GetIssuedHistory`, `GetBrokerSearch`, `GetNewsSearch`, `GetAllAnnouncement`. |
| HTTP client | Python `curl_cffi`; Go `tls-client` (uTLS) with **Chrome/Safari TLS-fingerprint impersonation "to get past Cloudflare WAF"** (README, verbatim). |
| Historical capability | `idx backfill --start … --end … --concurrency 8`; daily partitions compacted to monthly Snappy Parquet (`idx compact`); dashboard reports calendar gaps. |
| Index / sector coverage | IHSG (COMPOSITE), LQ45, sectoral indices; 952 tickers; sector RS measured vs IHSG. |
| Auth / rate limit / retry / pagination | Not documented beyond a `--concurrency` flag and `GetApiDataPaginated`. |
| Scheduling | `idx daily`; Termux cron `45 16 * * 1-5` (16:45 WIB weekdays); Docker compose. |
| Maintenance | Badges claim ≥85% coverage, 175–181 tests (README is internally inconsistent); clone URL is a `yourusername` placeholder. |

**Decisive finding.** `idx-bei`'s historical index/sector coverage comes from `GetIndexSummary` on `idx.co.id`, and
its _enabling technique_ is **TLS-fingerprint browser impersonation to defeat IDX's Cloudflare WAF**. That technique
is **out of bounds** for HakaPro under the brief's own constraints ("Do not bypass authentication, anti-bot
challenges, or access controls"; "Do not bypass provider restrictions") **and** under IDX's terms (commercial use
prohibited without written permission). So the one thing `idx-bei` has that HakaPro lacks — deep IDX-IC sector-index
history — cannot be legitimately adopted. No code was copied.

**Adaptable ideas (concept only, no code taken):** resumable date-range backfill, calendar-gap reporting, idempotent
daily partitions, cron after the WIB close. As Phase 2 shows, the engine already implements all four.

---

## 2. Existing HakaPro engine audit & gap assessment (Phase 2)

The engine (`services/engine`, Bun + TypeScript + drizzle/postgres-js) is already a mature IDX ingestion platform. It
is the single source of truth; **no new service or database was introduced.**

| Brief capability | Already in engine? | Where |
|---|---|---|
| Source registry with per-host policy (rate limit, one-in-flight) | ✅ | `sources/index.ts`, `registry.ts`, `fetch/rate-limit.ts` |
| Resumable, checkpointed, trading-day-aware backfill | ✅ | `schedule/backfill.ts` (`backfillJob`, `itemBackfillJob`; cursor in `job_cursors`; `isTradingDay`; night window) |
| Idempotent writes (precedence by source) | ✅ | `db/ingest.ts` (`upsertDaily`, `upsertIndexDaily` on `(code,date)`) |
| Retry / backoff / block-on-429 | ✅ | `fetch/fetcher.ts`, `fetch/block.ts`, source-state rest |
| EOD OHLCV + corporate actions | ✅ | `jobs/eod.ts` (Yahoo `range=5d` + backfill from 2020-01-01) |
| Index daily (COMPOSITE/LQ45/IDX30 + sectors) | ✅ snapshot only | `jobs/indices.ts` (TradingView `global/scan`) |
| **IHSG history** | ✅ **to 2020-01-01** | `jobs/eod.ts` backfills `^JKSE` (Yahoo) → `index_daily` |
| Source health / job history / observability | ✅ | `db/repos.ts` (`sourceHealth`, `recentJobHistory`), EOD-session tracking |
| Internal `/v1` market APIs | ✅ | `http/app.ts`, `serve/*` |
| **Index-series data-quality / coverage validation** | ❌ **gap** → implemented (§5) | new `serve/index-quality.ts` |
| **Historical IDX-IC sector indices** | ❌ **blocked** (no legitimate source) | §4 |

**The only true "crawler" gap that is legitimately fixable** was index-series data quality & coverage observability
(EOD stock sessions were validated; indices were not). That gap is now closed (§5). The sector-history gap is a
**data-access/licensing** blocker, not a code gap.

---

## 3. Source-adapter architecture (Phase 3)

The engine already realises the brief's `MarketDataSource` + capability-discovery pattern, adapted to its own
conventions rather than a forced new abstraction:

- `defineSource({ id, host, kind, policy, description })` registers a source; `kind` (`eod | intraday | reference |
  macro | news`) is the capability declaration, and `policy` is the per-host rate contract.
- On the **app** side the same idea is the `MarketDataSource` capability interface (`src/server/market/source.ts`):
  a source that cannot serve a capability returns `fail(<capability>)` → a typed `UNSUPPORTED` DataState, so the UI
  degrades honestly instead of fabricating. `indicesHistory` was added to this interface in the prior work block and
  is served by the engine lane only.

No new adapter abstraction was invented; forcing one would duplicate the working registry (brief: "Do not introduce
unnecessary services … Do not duplicate existing market-data pipelines").

---

## 4. Historical data availability & licensing matrix (Phase 4)

Symbols validated against the official IDX Industrial Classification (IDX-IC): 11 sector indices + the broad indices.
"Legitimate source" means reachable **without** bypassing auth/WAF/anti-bot and **without** a prohibited commercial
redistribution.

| Symbol | Legitimate history source | Earliest | In engine today | Note |
|---|---|---|---|---|
| IHSG / COMPOSITE | **Yahoo `^JKSE`** | ~2020 (engine backfill) | ✅ daily, backfilled | Benchmark — real depth already stored. |
| LQ45 | TradingView snapshot only | — | ✅ snapshot (forward-only) | No free history feed identified. |
| IDX30 | TradingView snapshot only | — | ✅ snapshot (forward-only) | " |
| IDXENERGY, IDXBASIC, IDXINDUST, IDXHEALTH, IDXFINANCE, IDXPROPERT (6) | **None free/sanctioned** | — | ✅ snapshot (forward-only) | Accrue going forward via the daily `global/scan`. TradingView data is experimental/internal, **not licensed for commercial redistribution.** |
| IDXNONCYC, IDXCYCLIC, IDXTECHNO, IDXINFRA, IDXTRANS (5) | **None free/sanctioned** | — | ❌ **not even resolvable** | Do not resolve on the TradingView scanner under any tried symbol; `idx.co.id` `GetIndexSummary` would carry them but sits behind the Cloudflare WAF (§1) — off-limits. |

Prior investigation (recorded last session) checked EODHD, Twelve Data, Stooq, investing.com, and Yahoo for the
IDX-IC sectors: none provide the sector indices on a free/sanctioned tier, and the brief forbids purchasing
subscriptions. **Conclusion: historical IDX-IC sector indices remain inaccessible by legitimate means.** No synthetic
sector history was created.

> **Live-coverage probe — pending your approval.** Reading the exact stored row counts/date ranges in the production
> `index_daily` requires the temporary scheduled-task method on the engine (the only read path to that DB). Creating
> that task was **denied by the Coolify auto-mode classifier** this session, so the exact per-code observation counts
> are **not yet verified against live data**. Grant `mcp__coolify__manage_scheduled_task` (or run the one-line probe
> yourself) and I'll fill in the real numbers. Structural facts above do not depend on it.

---

## 5. Implemented this session — index data-quality & coverage (Phases 6–8)

A pure, deterministic validator over `index_daily`, with no RRG coupling and no new service:

- **`services/engine/src/serve/index-quality.ts`** — `indexCoverage()` / `indexCoverageReport()` /
  `tradingDaysBetween()`. Per code: `count`, `firstDate`, `lastDate`, `spanTradingDays`, `missingSessions`
  (gaps inside the covered span), `staleTradingDays`, and generic flags `STALE` / `NON_POSITIVE_CLOSE` / `UNORDERED`.
  The trading-day calendar is injected, so the arithmetic is hand-verifiable.
- **`serve/market-info.ts`** — `serveIndicesHistory` now attaches `coverage` to the `/v1/indices/history` payload
  (observability surfaced through the route the RRG feature already consumes).
- **Shared schema** (`src/server/schemas/idx-bei.ts`) — `indicesHistorySchema` gains an **optional** `coverage` array
  (+ `IndexCoverageReport` type), so the engine and app share one contract and existing stubs stay valid.
- **Tests** — `serve/index-quality.test.ts` (8 tests: span, gap detection, stale threshold, non-positive/unordered,
  empty series, multi-code report).

Deliberately **not** built (would be unnecessary/duplicative or fabrication): a parallel crawler service; a second
backfill engine (the existing one already checkpoints/resumes/rate-limits); any synthetic sector history; any WAF or
anti-bot bypass.

---

## 6. RRG integration status (Phase 9)

- **Benchmark (COMPOSITE):** real daily history to ~2020 is already stored → the benchmark side is not the limit.
- **Sectors:** only forward-accrued snapshots exist (6 of 11 codes). `computeRotation` aligns on the **intersection**
  of sector and benchmark dates, so the usable window is bounded by the sector snapshots.
- The sector-rotation engine and UI were **not rewritten**. The existing **insufficient-data state** is preserved and
  is the correct behaviour until enough aligned sector observations accrue (daily defaults require 34). Activation is
  by observation count, not a calendar date. The new `coverage` field gives the panel real per-code freshness/gap
  data to display.

---

## 7. Verification (Phase 10) — actually executed

| Check | Result |
|---|---|
| Engine typecheck (`tsc -p services/engine`) | ✅ exit 0 |
| App typecheck (`next typegen && tsc --noEmit`) | ✅ exit 0 |
| Lint (changed files) | ✅ 0 problems |
| Unit tests (full `vitest run`) | ✅ **938 passed / 43 skipped** (+8 new quality tests; no regressions) |
| Engine HTTP + serve suites (schema-boundary validation of `/v1/indices/history`) | ✅ 103 passed |
| Production build (`build:check`) | ✅ exit 0; `/[locale]/discover/rotation` + `/api/indices/history` compiled |
| Live `index_daily` row/date retrieval | ⚠️ **not run** — scheduled-task probe denied by classifier (see §4) |

Per the brief: I am **not** claiming verified historical sector coverage — the live read was blocked, and no numbers
are asserted without it.

---

## 8. Remaining source & licensing limitations

1. **IDX-IC sector-index history is inaccessible** by legitimate means: the only known source (`idx.co.id`
   `GetIndexSummary`) is behind a Cloudflare WAF that `idx-bei` defeats via TLS impersonation — forbidden here — and
   IDX prohibits commercial redistribution without written permission.
2. **5 of 11 sectors** (NONCYC, CYCLIC, TECHNO, INFRA, TRANS) don't even resolve on the sanctioned TradingView
   scanner; the other 6 accrue forward-only and are **experimental / not licensed** for commercial production use.
3. **No paid feed evaluated/purchased** (EODHD, Twelve Data, etc.) — forbidden by the brief.
4. **Live stored-coverage numbers pending** one permission grant (§4).

**Net:** the legitimately feasible crawler improvement (index-series quality + coverage observability) is implemented,
tested, and builds clean; the headline historical-sector-index capability stays blocked by data access and licensing,
documented here rather than worked around.
