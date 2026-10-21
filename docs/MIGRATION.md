# HAKAPRO — Current PostgreSQL migration status

Updated 2026-10-14. The migration branch uses private Coolify PostgreSQL, Drizzle, and Better Auth for Google plus email/password. Product user-data and alert evaluation flows use server repositories; browser code has no database SDK. All original public tables and relationships have versioned schema/import tooling.

The isolated Coolify rehearsal applied the schema and imported the retained snapshot: 2 users, 2 Google accounts, 1 watchlist, 5 watchlist items, zero rows in the other 18 public tables, and zero Storage objects. Native-column reconciliation reported zero mismatches for all 22 imported tables. This validates that snapshot in rehearsal; a fresh frozen-source snapshot and production cutover are still required.

Supabase runtime clients/types/callback and SDK dependencies are removed from this branch. Build/auth settings use server-only `DATABASE_URL`, Better Auth, Google OAuth and SMTP variables listed in [README](../README.md) and `.env.example`. The application callback is `/api/auth/callback/google`. `/api/health` is liveness; `/api/ready` checks PG connectivity, auth/provider config and email prerequisites. CSP browser connections are same-origin.

Follow [database resources](migrations/coolify-resources.md), [schema migrations](migrations/postgres-schema.md), and [source import/reconciliation](migrations/source-data-import.md) for backups, private runner setup and final snapshot procedure. Production requires Google/SMTP setup, a recovery drill, ownership/auth/job smoke checks, reviewed production target controls, final reconciliation and coordinated switch. Keep source/previous deployment for rollback. After new target writes begin, rollback requires data reconciliation.

Tracking now uses Plane HEULAULAB project HAKAPRO (`HAKA`, renamed from HeulaTrade `HEULA` on 2026-10-15; ticket numbers kept) and the migration execution ledger. Migration items are HAKA-45…56. The HeulaTrade inventory below is historical; its original Supabase configuration, callback, RLS, deployment instructions and tracking decision have been superseded by this section.

---

## Historical HeulaTrade → HAKAPRO inventory

# HAKAPRO — Migration inventory (HeulaTrade → HAKAPRO)

Status: **Phase 1 complete through production readiness (slices S1–S7). Port status in §7; log in docs/PROGRESS.md.**
Date: 2026-10-03

| Input | Value |
| --- | --- |
| OLD_REPO_PATH | `~/kiyadev/heulaulab/heulatrade` (read-only; git `main` @ `39fc18b`) |
| NEW_REPO_PATH | `~/kiyadev/heulaulab/hakapro` |
| PACKAGE_MANAGER | `bun` (old repo pins `bun@1.3.14`, `bun.lock`) |
| PLANE_PROJECT | none — tracking in `docs/PROGRESS.md` |
| Visual direction | HAKAPRO init prompt §6 only (see §8) |

---

## 1. Architecture map (old repo)

HeulaTrade is a Next.js 16 App Router app (no `src/`, alias `@/*` → repo root) with **two independent market-data lanes** behind a BFF, plus Supabase for auth/user data.

```
Browser ──► Next.js BFF (app/api/**) ──┬──► Lane A "idx-bei": Python FastAPI market-api (services/market-api/app.py)
                                       │        reads idx-bei parquet/JSON snapshots (IDX_BEI_DATA_DIR)
                                       │        env: MARKET_API_URL
                                       └──► Lane B "arjum": external HTTPS provider (x-api-key header)
                                                env: HEULATRADE_MARKET_API_BASE_URL + HEULATRADE_MARKET_API_KEY
Browser ──► running-trade-gateway (Bun WS, separate deploy) ──► provider WS (stock.arjum.com)   [Phase 1: out of scope]
Browser/Server ──► Supabase (Auth + Postgres + RLS)
```

| Concern | Location |
| --- | --- |
| BFF route handlers | `app/api/**/route.ts` (27 routes), `app/auth/callback/route.ts` |
| Lane A server module | `lib/market/server.ts` (+ `MarketError`), `lib/market/providers/direct.ts` (fetch + in-memory TTL cache) |
| Lane A schemas | `lib/market/contracts.ts` (Zod: Quote, Candle, Overview, Signals, Fundamentals, Profile, Actions, Screener, News, Announcements, Capabilities) |
| Lane B client | `lib/market/arjum/client.ts` (`ArjumClient`, timeout 12s, error mapping), `queries.ts`, `errors.ts` |
| Lane B schemas | `lib/market/arjum/schemas.ts` (Zod, derived from real fixtures in `tests/fixtures/arjum/*.json`) |
| Lane B normalizers | `lib/market/arjum/normalizers.ts`, mapping inline in `lib/market/arjum/server.ts` |
| Lane B route wrapper | `lib/market/arjum/route.ts` (`marketRoute`: requires Supabase user, maps errors) |
| Input validation | `lib/market/arjum/inputs.ts` (`symbolSchema`, `dateSchema`, `positiveInt`) |
| Rate limiting / errors | `lib/api/http.ts` (in-memory per-IP window, `apiError`) |
| Client fetchers / query keys | `lib/api/client.ts` (Lane A, Zod-validated), `lib/api/market-client.ts` (Lane B, typed, **not** validated; `historyQueryKey`) — keys are ad-hoc arrays `['arjum', ...]` inside components |
| TanStack Query provider | `components/terminal/providers.tsx` |
| Zustand store | `stores/terminal-store.ts` (layout tree, panels, symbol, locks — terminal-only) |
| Supabase clients | `lib/supabase/client.ts` (browser), `lib/supabase/server.ts` (RSC/route), `lib/supabase/proxy.ts` + root `proxy.ts` (session refresh + route guard via `getClaims()`) |
| Supabase types / schema | `lib/supabase/database.types.ts` (generated), `supabase/migrations/20260921002404_initial_schema.sql`, `supabase/tests/rls.sql` |
| Domain logic | `lib/market/indicators.ts` (SMA/MACD), `lib/alerts/evaluate.ts`, `lib/portfolio.ts`, `lib/format.ts` |
| Terminal / commands | `lib/commands/registry.ts`, `lib/workspace-schema.ts`, `components/terminal/terminal.tsx` |
| Tests | Vitest `tests/*.test.ts`, Playwright `tests/e2e/*`, Python `services/market-api/tests` |

---

## 2. Endpoint inventory

Freshness note: old code has two enums. Lane A emits `EOD` / `STALE` (>7 calendar days old) / `UNAVAILABLE` (`app.py:224-229`). Lane B emits `SNAPSHOT` / `HISTORICAL` (`lib/market/arjum/server.ts:300`). HAKAPRO's enum has **no `SNAPSHOT`**, so every Lane B dataset is re-classified below. `asOf` must be the data date, never `fetchedAt`.

### Lane A — idx-bei via `MARKET_API_URL`

| BFF path | Upstream call | Params | Output schema | Cache | Freshness class |
| --- | --- | --- | --- | --- | --- |
| `GET /api/market` | `/v1/market` | — | `MarketOverviewSchema` (indices, breadth, movers) | `max-age=30`; direct.ts TTL 5 min | EOD (STALE >7d) |
| `GET /api/stocks/[symbol]` | `/v1/stocks/{s}?limit=1600` | symbol | `QuoteSchema` + `CandleSchema[]` | `max-age=30`; TTL 5 min | EOD quote / HISTORICAL candles |
| `GET /api/stocks/[symbol]/fundamentals` | `/v1/stocks/{s}/fundamentals` | symbol | `FundamentalsSchema` | `max-age=300`; `revalidate: 30` | periodic (report period `periodDate`) |
| `GET /api/stocks/[symbol]/actions` | `/v1/stocks/{s}/actions` | symbol | `ActionSchema` | `max-age=300` | HISTORICAL (event dates) |
| `GET /api/stocks/[symbol]/profile` | `/v1/stocks/{s}/profile` | symbol | `ProfileSchema` | `max-age=300`; TTL 24 h | reference; `dataAsOf=null` → UNAVAILABLE as-of `TODO(verify)` |
| `GET /api/securities/search` | `/v1/securities?q=` | q ≤80 | `SecuritySchema[]` | TTL 1 h | reference (no as-of) |
| `GET /api/signals` | `/v1/signals` | — | `SignalsSchema` (foreign-flow radar, accumulate/distribute) | `max-age=300` | EOD (briefing `trade_date`) |
| `POST /api/screener` | `POST /v1/screener` | `ScreenRequestSchema` (≤20 conditions, 14 fields) | `ScreenResponseSchema` | `no-store` | EOD (latest `stock_summary` date; ratios = latest report per code) |
| `GET /api/news` | `/v1/news` | page, pageSize | **mismatch** — route returns `{tradingDate, foreignFlow: []}` and drops items | `max-age=300`; TTL 15 min | `TODO(verify)` — broken in old repo |
| `GET /api/announcements` | `/v1/announcements` | keywords, page, pageSize | **same mismatch** as news | `max-age=300` | `TODO(verify)` — broken in old repo |
| `GET /api/ready` | `/health`, `/ready` + capability probes | — | capabilities object | none | n/a (ops) |
| `GET /api/health` | — | — | static | — | n/a |
| `GET/POST /api/ingestion/daily`, `/api/ingestion/backfill` | `/api/system/trigger-ingestion`, `/api/system/jobs` | dataset, dates | untyped | no-store | n/a — **unauthenticated trigger**, and app.py exposes no such routes |
| `POST /api/jobs/evaluate-alerts` | Lane A `getStock` + Supabase service role | Bearer `ALERT_JOB_SECRET` | `{evaluated, triggered, unavailable, failed}` | no-store | consumes EOD only |

### Lane B — arjum via `HEULATRADE_MARKET_API_*` (all routes require a Supabase user; `private, no-store`)

| BFF path | Provider call | Params | Output schema | Freshness class (HAKAPRO) |
| --- | --- | --- | --- | --- |
| `GET /api/search` | `/api/search` | q 1–80 | `searchResponseSchema` | reference; asOf = `last_date` |
| `GET /api/screener/latest` | `/api/screener/latest` | — | `screenerResponseSchema` (bucket, summary flags, note, raw) | EOD; `date` is a decorated string (`"📊 **SCREENER V5.2** — Jumat, 18 September 2026"`) → must be parsed to ISO `TODO(verify)` |
| `GET /api/analysis/[code]` | `/api/analysis/{c}` | code | `analysisResponseSchema` (Markdown-ish text) | EOD `TODO(verify)` asOf (embedded in text) |
| `GET /api/broker-summary/[code]` | `/api/broker-summary/{c}` | code | `brokerSummaryResponseSchema` | EOD (asOf `broker_end_date`) |
| `GET /api/broker-accumulation/[code]` | `/api/broker-accumulation/{c}` | start_date, end_date, top, brokers | `brokerAccumulationResponseSchema` | HISTORICAL (asOf `end_date`) |
| `GET /api/history/[code]` | `/api/history/{c}` | limit ≤5000, frame daily/weekly/monthly | `historyResponseSchema` (OHLC + foreign) | HISTORICAL; latest row EOD. Old code uses `rows[0].date` as asOf — ordering `TODO(verify)` |
| `GET /api/seasonal/[code]` | `/api/seasonal/{c}` | code | `seasonalityResponseSchema` | HISTORICAL (asOf null in old code) |
| `GET /api/market-cap` | `/api/market-cap` | date, page, per_page ≤250 | `marketCapResponseSchema` | EOD (asOf `date`) |
| `GET /api/financial-statements/[code]` | `/api/financial-statements/{c}` | report_type, period, limit, year | `financialStatementsResponseSchema` (recursive) | periodic (quarterly/annual; period = `label`) |
| `GET /api/insiders/[code]` | `/api/insiders/{c}` | page, limit ≤250, action_type | `insidersResponseSchema` | HISTORICAL (asOf latest `date`) |
| `GET /api/done-details` | `/api/done-details` | code, date, page, per_page ≤250 | `doneDetailsResponseSchema` | HISTORICAL intraday tape for `date` (not LIVE) |
| `GET /api/provider-health` | `/api/health` | — | `healthResponseSchema` | n/a (ops) |
| WS gateway | `wss://…/ws/running-trade` | Supabase token | `normalizeRunningTradeMessage` | would be LIVE — **out of scope Phase 1** |

---

## 3. Module classification

### PORT AS-IS (copied, adapted to `src/server/**`, paths/imports only)
| Old | New |
| --- | --- |
| `lib/market/arjum/client.ts`, `errors.ts`, `queries.ts`, `inputs.ts`, `schemas.ts` | `src/server/providers/arjum/*`, `src/server/schemas/arjum.ts` |
| `lib/market/arjum/normalizers.ts` + mapping in `arjum/server.ts` | `src/server/services/*` (+ freshness envelope) |
| `lib/market/contracts.ts` (Lane A Zod) | `src/server/schemas/idx-bei.ts` |
| `lib/market/server.ts` + `providers/direct.ts` (fetch, TTL cache, `MarketError`) | `src/server/providers/idx-bei/*` |
| `lib/market/indicators.ts`, `lib/alerts/evaluate.ts`, `lib/portfolio.ts` + their tests | `src/server/services/*` |
| `lib/supabase/{client,server,proxy}.ts`, `database.types.ts`, `app/auth/callback` | `src/lib/supabase/*`, merged with next-intl middleware |
| `lib/api/http.ts` (rate limit, error mapping), `arjum/route.ts` | `src/server/http.ts` |
| Route handlers listed in §2 (except ingestion) | `src/app/api/**` |

### PORT + EXTRACT
| Old | What to pull out |
| --- | --- |
| `app/api/news`, `app/api/announcements` + `lib/market/server.ts:getNews/getAnnouncements` | Bug: items are fetched then discarded. Port the real `NewsResponseSchema`/`AnnouncementResponseSchema` items instead. |
| `components/panels/provider-panels.tsx` | Broker ranking by VALUE/VOLUME/FREQUENCY (`:63`); seasonality/market-cap paging logic → services. |
| `components/panels/market-panels.tsx` | Foreign net = buy − sell over last 30 sessions (`:54-56`); watchlist/portfolio Supabase CRUD (`:83-128`) → `src/server/services/watchlist.ts` + hooks. |
| `components/panels/screener.tsx` | Saved screens + column prefs CRUD (`:37-75`), condition builder state. |
| `components/panels/alerts.tsx` | Alerts/notifications CRUD (`:20-32`). |
| `lib/format.ts` | Replace entirely with locale-aware `src/lib/format/*` (old is en-US only, `B` suffix, percent assumes fraction). |
| `lib/commands/registry.ts` | Keep only the destination list (name → description → requiresSymbol) as Cmd+K entries; drop parser/aliases/F-keys. |
| `app/api/ready` | Keep as ops endpoint; drop capability probing of broken news lane. |

### REFERENCE ONLY
`components/terminal/*`, `components/panels/*` (UI), `components/charts/price-chart.tsx` (lightweight-charts usage), `components/auth/login-form.tsx` + `app/(auth)/*` (behavior of email/Google/forgot/reset flows — rebuilt in new design), `app/page.tsx` landing, `DESIGN.md`, `HeulaTrade-PRD.md`, `docs/collections/HeulaTrade.postman_collection.json` (useful for verifying provider shapes).

### DROP
`stores/terminal-store.ts`, `lib/workspace-schema.ts`, `components/ui/resizable.tsx`, `react-resizable-panels`, `app/terminal`, `app/api/ingestion/*` (unauthenticated, upstream routes don't exist), `services/running-trade-gateway` (Phase 2), `.harness/`, `scripts/*` (keep `verify-bbca.ts` as reference), Supabase `workspaces`/`workspace_panels` tables & `save_workspace` RPC (left in DB untouched, just unused).

`services/market-api` (Python) is **not ported** — it stays the existing service HAKAPRO calls through `MARKET_API_URL` (rule 3: no new services).

---

## 4. Business logic hidden in UI / opaque provider text

1. **Strategy matching ("why matched") lives in the provider, encoded as emoji.** `screener/latest` returns `bucket` (e.g. `🥷 AKUMULASI SENYAP`), `summary` flags (`🌍 🥷`), `note` (`mode senyap`). The legend is only in the `raw` text: `✅=akumulasi | ❌=distribusi | 🏦=broker pekat | 🏛️=institusi | 🌍=asing beli | 🔬=teknikal kuat | 🥷=senyap | 🧬=edge historis | 🧨=jebakan historis | 🚀⚠️=pompa | ⏰=telat | 🔥=klimaks`, plus one description line per bucket. HAKAPRO must parse legend + bucket descriptions from `raw` into structured `criteria[]` (pure function, unit-tested) and render them as observed facts. Hard-coding the legend is a fallback only. `TODO(verify)` legend stability across screener versions (V5.2 seen).
2. **Analysis text contains signal language** (`🎯 SIGNAL Score 25/75 — NETRAL`, "Heavy buyer/seller"). Not displayed in Phase 1 (§9.5).
3. **Unit collision already present upstream:** analysis text uses English abbreviations inside Indonesian copy (`−57M lembar` = 57 million shares). Provider-formatted strings (`*_label`, `price_formatted`, insiders `*_value`) are parsed into numbers with explicit units and formatted by our own formatter. Unparseable strings are logged and never shown in a numeric context (§9.2).
4. Foreign net flow = `foreignBuy − foreignSell` (UI, `market-panels.tsx:56`; also screener `foreignNetShares` in Python).
5. Volume-ratio 20D and daily-change metrics (`lib/alerts/evaluate.ts`) — `changePercent` is a **fraction** (×100 for %); `formatPercent` assumes fraction too. Units must be documented per field.
6. Broker summary sorts by net value; `netFrequency = bfrq − sfrq` computed in normalizer.
7. Lane A `/v1/market` movers and breadth are computed in Python from the latest `stock_summary` row.

---

## 5. Environment variables (names only)

| Name | Scope | Used by |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase clients |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Supabase clients |
| `MARKET_API_URL` | server | Lane A |
| `STRATEGY_ENGINE_ENABLED` | server | `1` adds the Data Engine's EOD strategy scans (`/v1/strategies` over Lane A) to `/api/strategies`; off by default (draft rules, HAKA-17) |
| `HAKAPRO_ADMIN_EMAILS` | server | Comma-separated sign-in emails allowed on admin pages (`/admin/ownership`: KSEI ≥1% list uploads). Unset: no admins |
| `ENGINE_ADMIN_TOKEN` | server (secret) | The Data Engine's admin token (same value as the engine's), used only to forward ownership uploads to `MARKET_API_URL` |
| `HEULATRADE_MARKET_API_BASE_URL` | server | Lane B |
| `HEULATRADE_MARKET_API_KEY` | server (secret) | Lane B |
| `SUPABASE_SERVICE_ROLE_KEY` | server (secret) | alert job only |
| `ALERT_JOB_SECRET` | server (secret) | alert job only |
| `IDX_BEI_DATA_DIR` | Python service only | not used by Next.js |
| `HEULATRADE_RUNNING_TRADE_WS_URL`, `HEULATRADE_RUNNING_TRADE_WS_API_KEY`, `NEXT_PUBLIC_HEULATRADE_RUNNING_TRADE_GATEWAY_URL` | gateway | Phase 2 — omitted from `.env.example` |

Old `.env.local` contains **only the two Supabase variables**.

---

## 6. Risks and unknowns

1. **No market credentials locally.** Neither `MARKET_API_URL` nor the arjum key/URL is set in the old `.env.local`. Checkpoint 3 ("every endpoint returns real data in dev") needs either the arjum base URL + key, or a running Python market-api with a populated idx-bei data dir. Without them, endpoints can only be verified against the committed fixtures.
2. News/announcements are broken in the old repo (items dropped) — the real response shape is unverified end-to-end.
3. Freshness re-mapping: `SNAPSHOT` has no HAKAPRO equivalent; screener `date` and analysis as-of are embedded in prose.
4. Lane B requires an authenticated Supabase user on every call; Home must handle signed-out state.
5. History row ordering (old code takes `rows[0]` as as-of) is unverified.
6. Old `/api/ingestion/*` routes are unauthenticated job triggers — dropped.
7. Data-display rights for provider data (README "deployment gate") remain unresolved — product/legal, not engineering.
8. ~~Design conflict~~ — resolved: reference withdrawn (§8).
9. Version risks to confirm at scaffold: TanStack Table v9 vs shadcn's v8 data-table example, TypeScript 7, Zod 4 (old repo uses Zod 3 `z.record(valueSchema)` one-arg form, which changes in v4).

---

## 7. Port status tracker

| Old | New | Status |
| --- | --- | --- |
| `lib/market/arjum/{client,queries,errors,inputs}.ts` | `src/server/providers/arjum/*`, `src/server/market/errors.ts`, `src/server/schemas/inputs.ts` | ✅ ported |
| `lib/market/arjum/schemas.ts` | `src/server/schemas/arjum.ts` (Zod 4) | ✅ ported, all 12 fixtures parse |
| `lib/market/arjum/normalizers.ts` + mapping in `server.ts` | `src/server/services/arjum-normalize.ts` (unit-explicit fields) | ✅ ported |
| `lib/market/contracts.ts`, `server.ts`, `providers/direct.ts` | `src/server/schemas/idx-bei.ts`, `src/server/market/idx-bei-source.ts` | ✅ ported, untested against a live service (no URL) |
| News/announcements bug (items dropped) | `IdxBeiSource.news/announcements` return items | ✅ fixed, `TODO(verify)` live shape |
| `lib/market/indicators.ts`, `lib/portfolio.ts`, `lib/alerts/evaluate.ts` | `src/server/services/{indicators,portfolio,alerts}.ts` | ✅ ported with tests |
| Broker ranking (`provider-panels.tsx:63`), foreign net (`market-panels.tsx:56`) | `rankBrokers`, `foreignNet` | ✅ extracted |
| Screener emoji flags (why matched) | `src/server/services/why-matched.ts` | ✅ new, mapping table + snapshot tests |
| Provider number strings | `src/server/services/parse-number.ts` | ✅ new |
| `lib/api/http.ts`, `arjum/route.ts` | `src/server/http.ts` (`marketRoute`) | ✅ ported |
| `lib/supabase/*`, `proxy.ts`, `app/auth/callback` | `src/lib/supabase/*`, `src/proxy.ts`, `src/app/auth/callback` | ✅ ported (locale merge in Step 4) |
| `app/api/jobs/evaluate-alerts` | `src/app/api/jobs/evaluate-alerts`, `src/server/services/alert-job.ts` | ✅ ported (EOD-only, tested) |
| `app/api/analysis/[code]` | — | ⛔ not exposed (MIGRATION §9.5) |
| `app/api/ready` | `src/app/api/ready`, `src/server/readiness.ts` | ✅ rewritten (states only, no secrets) |
| Query keys / client fetchers | `src/lib/query/*`, `src/lib/api/*` | ✅ built (Steps 5–7) |

### Endpoint map (old → new)

| Old BFF path | New path | Source method |
| --- | --- | --- |
| `/api/screener/latest` | `/api/strategies` | `strategies()` (structured why-matched) |
| `/api/signals` | `/api/foreign-flow` | `foreignFlow()` (`accumulate/distribute` → descriptive `net_buy/net_sell`) |
| all other §2 paths | unchanged | 1:1 |

## 8. Visual direction

Visual direction comes **only** from the HAKAPRO init prompt §6 (dark-first + light theme, restrained semantic color, Geist Sans for UI / Geist Mono for tickers, prices and numeric tables, comfortable + compact density, no giant SaaS cards, glassmorphism or terminal styling). The external CRM reference was withdrawn at Checkpoint 1 and is not used.

---

## 9. Checkpoint 1 decisions (approved 2026-10-03)

1. **Design reference withdrawn.** See §8.
2. **Provider number strings are parsed, never passed through.** Example: `"-57M lembar"` → `{ value: -57_000_000, unit: "shares" }`, then formatted by `src/lib/format`. Unit tests use real fixture strings. Strings that can't be parsed reliably are logged and kept out of numeric contexts.
3. **"Why matched" parsing.** An explicit mapping table for known flags (legend in §4.1), snapshot tests from real samples, and unknown flags rendered as "unrecognized criterion" and logged, never dropped.
4. **Freshness: no `SNAPSHOT`.** A Lane B `SNAPSHOT` is mapped from the parsed data date: current session → `DELAYED`, previous session → `EOD`, older → `STALE`, unparseable → `UNAVAILABLE`. Never `LIVE`.
5. **Analysis text is not displayed in Phase 1.** No raw analysis, scores, or labels such as "NETRAL" or "Heavy buyer". Only structured, descriptive, observed facts.
   **Revised 2026-10-04 (user decision):** the analysis *is* shown, as a stock tab labelled "Analysis", but never in the provider's wording. `src/server/services/analysis-parse.ts` reduces the text to numbers and enums; HAKAPRO words every label itself (en/id), recomputes labels derivable from numbers (RSI zone, MACD direction, position vs SMA, volume level), and drops advice prose, notes and the provider disclaimer. Unrecognized lines are logged (`analysis_unparsed`), never passed through. The outlook (stance, entry, targets, stop) is shown with "the analysis's computed outlook, not a HAKAPRO recommendation" next to it, plus the research disclaimer.
6. **Market data.** `MarketDataSource` interface with a fixture-backed implementation built from `tests/fixtures/arjum/*.json` (copied in). All tests run against fixtures. The user adds real arjum credentials to `.env.local` for a manual check. Env values are never printed, logged or committed.
7. **Versions.** Schemas ported to Zod 4. `@tanstack/react-table` pinned to v8 to match shadcn.
8. **Tracking.** `docs/PROGRESS.md`; no Plane.

## 11. arjum coverage (completed 2026-10-04)

Source of truth: the public docs registry on stock.arjum.com (13 REST endpoints; MCP server `https://stock.arjum.com/mcp` with 15 tools = the 13 + `harga_batch` and `analisa_batch`). Every documented parameter was verified with one paced live run (15 requests, 2026-10-04); real samples are frozen in `fixtures/arjum-baseline/samples-2026-10-02/`.

| Endpoint | Parameters used | Where in HAKAPRO |
| --- | --- | --- |
| `/api/screener/latest` | — | Discover › Strategies |
| `/api/analysis/{code}` | code | Stock › Analysis; Watchlist › Compare analysis (`/api/analysis?symbols=`, ≤5, sequential = `analisa_batch`) |
| `/api/broker-summary/{code}` | start_date, end_date, flow (all/F/D), net, broker_limit, level_limit (≤200) | Stock › Flow (latest session or chart range, investor type, net, count; paired buyer/seller levels with average prices) |
| `/api/broker-accumulation/{code}` | start_date, end_date, top, brokers | Stock › Flow (range follows chart; broker-code filter) |
| `/api/history/{code}` | limit, frame, start_date, end_date (+ `data_available`) | Header, Overview, Chart, Flow, History (date range, available span), quotes |
| `/api/seasonal/{code}` | — | Stock › History |
| `/api/market-cap` | page, per_page, date, codes (≤50, `not_found`) | Movers (paged, by date), Overview valuation, Watchlist market caps |
| `/api/financial-statements/{code}` | report_type, period (`quarterly`/`annually`), limit (≤40), year | Stock › Financials (report, period, year, period count). Fixed: HAKAPRO sent `annual`. |
| `/api/insiders/{code}` | page, limit (≤15), action_type | Stock › Insiders (holders + paged transactions), Ownership changes |
| `/api/done-details` | code, date, page, per_page | Stock › History trade tape (session picker, pages) |
| `/api/price/{code}` | code | Stock header (today's price, market state); watchlist quotes during sessions (= `harga_batch`) |
| `/api/search` | q | Search, company names |
| `/api/health` | — | `/api/provider-health`, `/api/ready` (with daily quota from `x-ratelimit-*` headers) |

Not used, deliberately: `all_data` (broker_limit=200 already covers every IDX broker), the MCP-only `fields` projection (REST docs don't list it). The site's own internal paths (`/api/realtime`, `/api/done-details/dates`, `/api/stock`) are undocumented for API keys and are not called (§10).

Freshness: today's price is DELAYED during a session (as-of = last trade time, WIB) and EOD after it, never LIVE; a multi-session broker summary is HISTORICAL with its range as period.

## 10. Provider conduct (permanent rule, decided at Connection Network N1, 2026-10-03)

> **Revised 2026-10-16 for the experimental internal Data Engine:** crawling public sources is allowed, but access protections are never bypassed. See [DATA-ENGINE.md §2](features/DATA-ENGINE.md). The rules below still apply to the app's own provider calls (arjum and idx-bei clients in the BFF).

Applies to every provider (arjum, idx-bei, any future source), to app code, scripts, and agents working on this repo.

1. **Only call documented endpoints the app actually uses.** No probing of undocumented paths, and no crawling: no loops over symbols or pages beyond what a user action, the reviewed fixture recorder, or the reviewed drift sweep needs.
2. **On 429: stop and back off; never retry in a tight loop.**
   - App (`src/server/providers/backoff.ts`): after a 429, the provider client sends nothing until the cooldown ends. The cooldown is `Retry-After`, clamped to 60 s–15 min. Callers get `RATE_LIMITED` with the remaining seconds. The browser never auto-retries a 4xx (`shouldRetry`).
   - Recorder (`scripts/record-fixtures.ts`): the first 429 ends the run without a retry. Nothing is written, and the previous dataset is kept.
3. **Honest identification.** Every outbound request sends `PROVIDER_USER_AGENT` (`src/server/config/provider-identity.ts`), which identifies HAKAPRO.
   - Headers or clients are never chosen to get past a block.
   - If a provider blocks a client, report it to the product owner instead of working around it.
4. **Datasets from third parties** (snapshots, CSVs, other repos' data) are not ingested, copied or committed without a decision on origin and terms (see `docs/features/CONNECTION-NETWORK.md`, "Data Engine inputs").
5. **Tax and ID numbers** (NPWP, NPKP, NIK/KTP, SID, passport) are stripped at the parsing boundary (`src/server/services/strip-identifiers.ts`, applied in `profileSchema`). They never reach a response, a log or the UI. A route-level test proves it.

Record of a breach before this rule existed (N1 discovery): 6 undocumented arjum paths were probed (all 403). One Cloudflare block (error 1010) on a script's default Python user agent was bypassed by setting a different user agent rather than being reported first. Neither may happen again.
