# HAKAPRO — Progress

## PostgreSQL migration — current branch (2026-10-14)

- Coolify production/rehearsal PostgreSQL 17 resources are private, persistent, and have daily local backups (seven copies). Dashboard PostgreSQL is a separate resource.
- Drizzle schemas preserve all 20 public application tables plus Better Auth auth tables. Google identity import retains user UUIDs and provider subjects; existing sessions are invalidated. Email/password verification/reset use SMTP when fully configured.
- Watchlists, saved screeners and alerts use server actions and session-scoped PostgreSQL repositories. Alert evaluation keeps the existing bearer-secret endpoint; EOD idempotency rests on the `(alert_id, observed_as_of)` unique constraint with `ON CONFLICT DO NOTHING` (no transaction or advisory lock; see HAKA-49 below).
- Controlled Coolify rehearsal applied schema and imported the private retained snapshot: 2 users, 2 Google accounts, 1 watchlist, 5 items, other 18 public tables empty, Storage bucket empty. All 22 imported tables reconciled with zero mismatches. The rehearsal backup remains in its dedicated private volume; runner secrets/tasks were removed and it is stopped.
- Runtime cleanup removes Supabase SDK/client/types/legacy callback, browser-public auth settings and CSP origin exceptions. Docker build uses compile-only server placeholders; real secrets stay runtime-only. Health is liveness; readiness checks PG connectivity and required auth/provider/email configuration.
- The domainless Coolify rehearsal app (`hakapro-rehearsal-app`) is deployed from reviewed commit `902f074` and reports healthy. Its internal readiness probe confirmed PostgreSQL `CONNECTED`; overall readiness remains blocked by missing Google/SMTP and real market-data source settings. Coolify's extra healthcheck is disabled because it assumes `curl`/`wget`; the Dockerfile's Node healthcheck passes.
- Production has not switched. Google/SMTP credentials, real OAuth/email/ownership/job smoke checks, restore drill, final frozen snapshot/reconciliation and coordinated deployment remain pending. Track migration in Plane HEULAULAB / HAKAPRO (`HAKA`), module "Postgres Migration & Cutover": HAKA-52 Google/SMTP credentials (blocked on owner), HAKA-49 alert-job rehearsal, HAKA-53 restore drill, HAKA-54 production import, HAKA-55 cutover and smoke checks, HAKA-56 stabilization. The Plane project was renamed from HeulaTrade (`HEULA`) on 2026-10-15; HeulaTrade terminal/workspace items HAKA-5…11 and 16 are cancelled (dropped per MIGRATION §3).
- Task 7 passed typecheck, targeted lint, diff check, runtime-reference scan, independent review, and a Coolify build/deployment. No automated tests were run. Earlier dated entries below describe the initial Supabase implementation and are historical.

## HAKA-49 alert job verification (2026-10-16)

Branch `test/alert-job-pg`. Old evaluator: route at `5e64c44^` (Supabase service role + PostgREST); new: Drizzle on PostgreSQL. `runAlertJob`, `alerts.ts`, the schema and the `alert_event_notification` trigger are unchanged by the port.

Reconciliation (old → new):
- Alerts evaluated: enabled only, ordered by id, pages of 200 (`range` → `offset/limit`). Same.
- Measures/conditions/units: shared `observedMetric`/`triggered`; DAILY_CHANGE thresholds are percent units (-0.79 = -0.79%), PRICE IDR, VOLUME/FOREIGN_NET shares, ratio unitless. Same. `threshold` arrives as a JSON number (old) or numeric string (new); `z.coerce.number()` yields the same value.
- `observed_value`: JSON number (old) vs `String(value)` (new), both rounded by `numeric(24,6)` (ratio 1.4635142966 → 1.463514). Same.
- Idempotency: `upsert … ignoreDuplicates` (old) vs `onConflictDoNothing` on the same unique constraint (new); both report a trigger only for a new row. Same; neither uses a transaction or lock, and none is needed (concurrent runs verified below).
- Event/notification side effects: identical trigger (sets `last_triggered_at`, one notification per inserted event, type by metric). Works for a non-owner DML-only role (`SECURITY DEFINER`).
- Errors: alert query failure → 502 `ALERT_QUERY_FAILED` in both; insert failure → `failed` count in both. New: market-source config errors are inside the `try` (502 instead of an unhandled 500); missing `DATABASE_URL` → 503 `NOT_CONFIGURED` (was missing Supabase env).
- EOD gating — **bug in both**: sources label daily history `HISTORICAL`, so the job counted every alert as unavailable and never created an event. Fixed: `classifyDailyHistory` classifies the newest row against the IDX session clock (EOD after 16:15 WIB / before the next open; DELAYED in session; older STALE). Fixture data (`fixture:*`) stays HISTORICAL. Confirmed: the develop route returned `evaluated 0, unavailable 13` against provider-shaped data; the fixed route evaluates.
- The fetch/insert pair moved to `postgresAlertJobStore` (`src/server/services/alert-job-store.ts`), shared by the route and the integration script.

Run (throwaway `postgres:17-alpine` on 127.0.0.1, `bun run db:migrate`, container removed afterwards): 2 users, 14 alerts (13 enabled: every metric with firing/non-firing and boundary GTE/LTE cases, one disabled, one TLKM without data).
- `bun --conditions=react-server scripts/alert-job-integration.ts` (optional, loopback-only, baseline BBCA 2026-09-18): fixture source → `evaluated 0, unavailable 13`, 0 rows; two concurrent first runs → 12 evaluated each, 7 triggered in total, 7 `alert_events`, 7 `notifications` (4 PRICE, 1 FOREIGN_FLOW, 2 VOLUME, owners correct); rerun → `triggered 0`; a later clock (STALE) → `evaluated 0`; `last_triggered_at` set on the 7 fired alerts only. Passed as superuser and as a DML-only role; repeatable.
- Route via `next dev` (`MARKET_DATA_SOURCE=arjum` pointed at a local stub serving the baseline BBCA history re-dated to session 2026-10-15; no provider called): no/wrong bearer → 401; run 1 → `{evaluated 12, triggered 7, unavailable 1, failed 0}`; run 2 → `triggered 0`. Totals: 14 events (7 per session), 14 notifications (exactly one per event). With `MARKET_DATA_SOURCE=fixture` the route returns `evaluated 0, unavailable 13`. Database stopped → 502 `ALERT_QUERY_FAILED`, logged as `alert_job_failed`.
- Not verified: real arjum responses and timing of the provider's same-day row at 16:45 WIB (if absent, the previous session reads STALE and nothing is evaluated that day); IDX holiday calendar remains TODO(verify); the Coolify scheduled task itself.

## Historical build log

| # | Checkpoint | Status | Commit |
| --- | --- | --- | --- |
| 1 | Inventory (`docs/MIGRATION.md`) | ✅ approved 2026-10-03 with corrections (MIGRATION §9) | — |
| 2 | Scaffold: typecheck / lint / build pass | ✅ approved 2026-10-03 | a46b4fc |
| 3 | Data layer ported, fixture-backed `MarketDataSource`, unit tests | ✅ approved 2026-10-03 | 11cce02 |
| 4 | Foundations: i18n, format module, tokens, FreshnessBadge | ✅ done ("continue" 2026-10-03) | 9470e2c |
| 5 | App shell | ✅ done ("continue" 2026-10-03) | 3f35931 |
| 6 | Primitives | ✅ approved 2026-10-03 | eabc709 |
| 7 | Vertical slice: Home → Strategies → Why matched → Stock Overview | ✅ done ("continue" 2026-10-03) | e46e0ae |
| S1 | Auth pages + watchlist with quotes | ✅ | ed25368 |
| S2 | Stock Flow tab | ✅ | 399fec6 |
| S3 | Stock Financials tab | ✅ | 37f6f15 |
| S4 | Screener + saved screens | ✅ | 26f0a97 |
| S5 | Movers, News & Calendar, Ownership Changes | ✅ | 558789a |
| S6 | Chart, Insiders, History, Ownership tabs | ✅ | 54e2fae |
| S7 | Production readiness | ✅ | 1de1e69 |
| S8 | Alerts page (create/toggle/delete, triggered events) | ✅ | see git log |
| S10 | Public landing page at `/{locale}`; research home moved to `/{locale}/dashboard` | ✅ | see git log |
| S9 | Full arjum coverage: price, analysis, every documented parameter (MIGRATION §11) | ✅ | see git log |

## Checkpoint 2 notes
- Scaffold: create-next-app 16.3.8 (TS, App Router, Tailwind v4, ESLint, `src/`, `@/*`, Turbopack), shadcn 4.21.1 `radix-nova` preset, Radix base.
- TypeScript stays on 5.9.3 (create-next-app default; TS 7 exists but is not the default).
- `@tanstack/react-table` pinned to `^8` (8.21.3) per decision §9.7.
- Recharts 3.8.0 came in via `shadcn add chart`, cmdk 1.1.1 via `shadcn add command`.
- Fonts come from the `geist` package (`--font-geist-sans` / `--font-geist-mono`). Fixed shadcn's self-referencing `--font-sans`.
- Bun blocked postinstall scripts for `@parcel/watcher` and `@swc/core` (transitive). The build doesn't need them. Left untrusted.
- Vitest runs in a Node environment, with `server-only` aliased to a stub for unit tests. Playwright projects are desktop + mobile on port 3200.

## Checkpoint 3 notes
- `MarketDataSource` interface (`src/server/market/source.ts`). Implementations: `ArjumSource`, `IdxBeiSource`, `FixtureSource`. Selected by `MARKET_DATA_SOURCE`; `arjum` mode also uses idx-bei for capabilities arjum lacks, but only when `MARKET_API_URL` is set.
- **Production guard:** `next.config.ts` calls `resolveMarketDataSource`. `next build` and `next start` exit 1 when the source is missing or set to `fixture`, for both `NODE_ENV=production` and `VERCEL_ENV=production`. As a result, a local `bun run build` needs `MARKET_DATA_SOURCE=arjum` (no credentials are needed to compile). `typecheck` passes that value to `next typegen` only, because typegen loads config in the production-build phase.
- **Fixture mode:** the FIXTURE DATA banner renders in the root layout (it moves into the app shell in Step 5). Fixture freshness is capped at HISTORICAL/UNAVAILABLE (`clampFixtureFreshness`). Unit and Playwright tests cover both.
- **Server-only boundary:** `bun run check:server-boundary` checks that the Vitest stub is only aliased in `vitest.config.mts`, that the real package throws outside react-server, and that `next build` fails when a client component imports `src/server/log.ts`.
- `asOf` is `string | null`: null only alongside UNAVAILABLE (enforced by `withFreshness`).
- **Units:** all domain percent fields use percent units. arjum `change_pct` is already a percent; idx-bei fractions are multiplied by 100.

## Post-Checkpoint 3: auth fails closed
- `src/server/config/auth.ts` `resolveAuthConfig`. Production requires both Supabase vars and rejects `DEV_AUTH_BYPASS`, so `next build` and `next start` exit 1. Dev: `DEV_AUTH_BYPASS=1` (only the literal `1`) skips auth. Without the bypass and without Supabase config, protected routes answer 503 `AUTH_NOT_CONFIGURED`. A missing env var never opens access.
- `checkAccess()` (`src/server/auth.ts`) must guard every protected server entry point, including future server components that read market data.
- Guards are skipped only for `next typegen`, which generates route types and runs nothing.
- **Local production build check:** `MARKET_DATA_SOURCE=arjum NEXT_PUBLIC_SUPABASE_URL=… NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… bun run build`.
- **Manual real-data check (dev):** in `.env.local` set `MARKET_DATA_SOURCE=arjum`, `HEULATRADE_MARKET_API_BASE_URL`, `HEULATRADE_MARKET_API_KEY` and `DEV_AUTH_BYPASS=1`. Run `bun run dev --port 3200` and open `/api/strategies`. The AUTH BYPASS notice stays visible.

## Fixture recording (Checkpoint 3 follow-up, item 3)
- **Run it yourself:** `bun run record:fixtures` (optionally `-- --limit 10`). It needs `HEULATRADE_MARKET_API_BASE_URL` and `HEULATRADE_MARKET_API_KEY` in `.env.local`. It records the strategy screener, every matched symbol (25 at most by default) plus BBCA, and for each symbol: broker summary and accumulation, history (daily, 120 rows), seasonality, three quarterly financial statements, insiders and trade details. It also records market cap, health and per-symbol search, and since 2026-10-04 today's price and the analysis text per symbol (the analysis is parsed, never shown verbatim).
- **Stripped:** request headers are never written. Keys that look like credentials or user identifiers are dropped. The API key value and the provider host are replaced with `[REDACTED]`. Trade-detail order numbers become `REDACTED`. Every file is re-validated after sanitizing, and a file that fails is not written. Public disclosure data (insider names, broker codes) is kept. Logs show API paths only.
- **Atomic writes:** output is staged in `fixtures/.arjum-recording-*` and swapped into `fixtures/arjum/`. Per-request failures are listed in `manifest.json` and the run continues. If the screener fails, nothing is written and the command exits 1.
- **Two datasets:** `fixtures/arjum-baseline/` holds the frozen heulatrade samples from 2026-09-18 (order numbers redacted, with a manifest). Unit tests pin to it, so re-recording can't break value-pinned tests or snapshots. `FixtureSource` reads `fixtures/arjum/` whenever that directory has a manifest, and falls back to the baseline otherwise.

## Post-Checkpoint 3: freshness corrections
- **IDX schedule and holidays** are in `src/server/config/idx-calendar.ts`: Mon–Thu 09:00–12:00 / 13:30–15:49, Fri 09:00–11:30 / 14:00–15:49, final after 16:15, plus the fixed-date 2026 holidays. All of it is TODO(verify) against IDX's official sources, and the classifier is designed so errors land on the less fresh label.
- **Financial statements:** as-of is the reporting period end. `fetchedAt` is kept per period, and `filingDate` is null (the provider doesn't supply it). `reportingLag` compares the newest period to the reporting deadlines in `src/server/config/reporting.ts` (30/90 days, TODO(verify)). When the newest period is behind, live freshness is STALE. In fixture mode the label is capped at HISTORICAL, but the lag flag stays in the data.
- **Seasonality:** HISTORICAL, with `coverage` {from, to} derived from the data, as-of = last covered month, period = "from/to".

## Checkpoint 4 notes
- **i18n:** next-intl 4. Locales `id` (default) and `en`, always in the URL. `localeDetection: false`, so `/` → `/id` regardless of the browser language. Messages are in `src/i18n/messages`. Only client namespaces (freshness, locale, theme, density) are serialized to the browser. Glossary: `docs/GLOSSARY.md`.
- **Proxy:** next-intl routing runs first, then the Supabase session refresh is applied to the same response. `/_next/*` is excluded from the matcher (HMR breaks otherwise). Locale-aware login redirect: `/{locale}/login`.
- **Tokens:** `src/app/globals.css`. Dark-first (`html.dark`), with `.light` for the light theme. Semantic colors are positive / negative / warning / info / neutral. Density uses `[data-density]` with the `h-row`, `px-cell-x`, `py-cell-y` and `text-data` utilities. Components must use tokens, not `dark:` variants, so scoped themes work.
- **Format module:** `src/lib/format`. Per-locale suffix tables (id rb/jt/M/T with a space; en K/M/B/T without), explicit signs, labelled share/lot units. Timestamps are assembled by hand so server and browser ICU can't disagree.
- **FreshnessBadge:** `src/components/feedback/freshness-badge.tsx`. Six localized states; tooltip on hover/focus shows as-of, period and source.
- **Dev page:** `/[locale]/dev/primitives` (404 in production). Shows every state in both themes × both densities; switch locale via the link.
- **Testing:** use `localhost`, not `127.0.0.1`. Next 16 blocks dev resources for other origins, so pages don't hydrate.

## Checkpoint 5 notes
- **Shell:** `src/app/[locale]/(app)/layout.tsx`. A fixed-height frame: the banner, then sidebar | (header, scrolling main, mobile bottom nav). The banner stays visible because only `main` scrolls.
- **Sidebar** (`components/layout/app-sidebar.tsx`): pure CSS breakpoints, so server and client render the same.
  - Hidden below `md`.
  - `md`–`lg` (tablet): a 56px icon rail with tooltips; labels stay in the accessible name.
  - `xl`+: full labels, with Discover as a labelled group.
  - Stock pages are not nav items.
- **Header:** the search box opens the Cmd+K palette (the only global stock search), plus the language, theme and density switches and the account menu. Theme and density are written to cookies and applied to `<html>` immediately. Initial state comes from server-read cookies, so there are no hydration mismatches.
- **Cmd/Ctrl+K palette:** stock search via `/api/search`, with a freshness badge on the result group. Stock tabs appear for the current page's stock, the top result or a typed ticker. All pages are listed. Saved screens come from Supabase `saved_screeners` when signed in; otherwise it shows a sign-in hint. Open state lives in zustand (`lib/stores/ui.ts`).
- **Mobile:** a bottom nav (Home, Search, Watchlist, More). The More sheet holds Discover, News and display settings. "Alerts" isn't built, so the fourth item is More.
- **URL state:** `NuqsAdapter` is mounted. Stock tabs are routes (`/stock/BBCA/chart`). Lower-case tickers redirect to the canonical upper-case URL; invalid tickers 404.
- **Query setup:** `lib/query/{client,keys}.ts`; `lib/api/envelope.ts` validates every freshness envelope on the client.
- **Pages:** placeholder pages exist for every nav route and stock tab, to be replaced in Steps 6–7. The account menu's Sign in link goes to `/login`, which isn't built yet.
- **Testing:** Playwright projects are desktop (1280), tablet (820, touch) and mobile (Pixel 7).

## Checkpoint 6 notes
- **Primitives** (all rendered with API data on `/[locale]/dev/primitives`):
  - `components/layout`: SectionHeader, FilterBar (+ FilterSearch, FilterChips; nuqs URL state), Drawer (right panel on desktop, bottom sheet on mobile), UrlTabs (nuqs `?tab=`), CommandPalette (in the shell).
  - `components/market`: MetricCard, StockHeader, InsightCard, ChartCard (with a chart/table toggle), ChangeValue (▲/▼ plus sign).
  - `components/data`: DataTable (TanStack Table v8 + Virtual, measured rows, sortable, sticky header), ScreenerTable + CriteriaList (why matched; unknown flags shown as "unrecognized criterion"), StockRow.
  - `components/feedback`: StatusBadge, EmptyState, DataState (loading / error-with-reason-code / empty), FreshnessBadge.
  - `components/charts`: PriceChart (Lightweight Charts: candles plus a separate volume pane, crosshair readout, TradingView attribution logo, NOTICE in code and `THIRD_PARTY_NOTICES.md`), DivergingBarChart (Recharts via shadcn chart), ChartRangeToggle (`?range=`).
- **Freshness rule:** every container-level data component takes `meta: FreshnessMeta` and renders a FreshnessBadge. StockRow is the exception: rows inherit freshness from their section, so lists stay calm.
- **Chart colors:** `--chart-up`/`--chart-down` were validated with the dataviz palette checker (lightness band, chroma, deutan ΔE ≥ 8, contrast) in both themes. Text keeps `--positive`/`--negative` (WCAG AA 5.0–8.7:1). Polarity is never color-only: signs, ▲/▼, side of baseline.
- **Client API:** `lib/api/market.ts` holds Zod schemas mirroring the domain types and `marketApi`; `lib/api/hooks.ts` holds the TanStack Query hooks; `lib/query/keys.ts`.
- **Playwright:** workers capped at 2 (dev-server compile contention at 4).
- **TODO(verify):** the recorded broker-summary has 20 brokers, all net buyers, so the "top & bottom" chart shows no sellers. Check whether the provider truncates the list.

## Checkpoint 7 (final): vertical slice report

### What works (fixture data in dev; same code path for arjum)
- **Home** (`/[locale]`): market condition and coverage from the screener (provider's own label); strategy opportunities with why-matched criteria and the research disclaimer; indices/breadth, movers and news via the idx-bei lane (they show their reason when that lane is absent); active sectors states there is no source; watchlist activity from Supabase when signed in, otherwise a sign-in prompt.
- **Strategies** (`/discover/strategies`): screener context plus a list of strategies with description, match count, tickers and criteria.
- **Strategy** (`/discover/strategies/[id]`): ScreenerTable with observed criteria; "Why" opens the why-matched drawer (`?why=SOCI` URL state), which shows criteria, provider note, strategy description, freshness, disclaimer and a "Research SOCI" link to the overview.
- **Stock Overview** (`/stock/[symbol]`): the header (price, ▲/▼ change, freshness, company name) sits above the tabs. Then key metrics, a price chart with URL range, and five independent insight sections, each with its own freshness or error reason:
  - price: range change, high/low, close vs 20-day SMA
  - foreign flow: 5/20-session net
  - brokers: top net buyers/sellers, with no invented sellers
  - insiders
  - financials: latest period plus reporting-lag warning
  - Followed by deep-dive links and the disclaimer.
- **Server:** `/api/overview/[code]` aggregates per-dataset summaries (`src/server/services/stock-summary.ts`, pure and unit-tested; `stock-overview.ts` with partial-failure tolerance).
- **Reusable `ResearchDisclaimer`** is shown wherever strategies or derived observations appear.

### Stubbed / not built
- Stock tabs other than Overview are placeholders.
- The Screener, Movers, Ownership Changes, Watchlist and News pages are placeholders.
- `(auth)` login/signup pages: the account menu "Sign in" link 404s.
- Watchlist rows have no quotes (needs a batched quote endpoint).
- Saved-screen links don't run screens yet.
- Analysis text is deliberately not exposed (MIGRATION §9.5).
- Alert job route and `/api/ready` are deferred.

### Known issues
- **Fixture coverage:** only BBCA has per-stock recordings, so the strategy flow lands on SOCI/HRTA pages that honestly show NOT_RECORDED until `bun run record:fixtures` is run.
- **Recorded broker summary** has only net buyers (20 brokers); the provider may truncate. TODO(verify).
- **Dev-only React warning** "Failed to execute 'measure' on 'Performance' … negative time stamp" (Next dev performance tracks); no user impact observed.
- **E2E rate limits:** e2e needs `E2E_RATE_LIMIT_SCALE` (set in playwright.config) because all tests share one IP against the per-route rate limiter.

### Open TODO(verify)
- Real arjum responses (manual check with credentials) and a fresh recording.
- IDX session times, Friday hours, holiday calendar (`src/server/config/idx-calendar.ts`).
- OJK/IDX reporting deadlines (`src/server/config/reporting.ts`).
- Criteria phrasings vs provider meaning (`docs/GLOSSARY.md`); screener legend stability across versions.
- Seasonality and up-probability units; financial-statement fetch timezone; filing date source.
- idx-bei lane end-to-end (no `MARKET_API_URL` tested); news/announcements live shape.
- Market-data display rights (product/legal).

### Proposed next slices
1. **Auth pages** (login/signup/reset with Supabase, locale-aware) and the watchlist page with quotes (batched quote endpoint).
2. **Stock Flow tab:** broker summary table + accumulation chart + foreign flow series (data already ported).
3. **Stock Financials tab:** statement tables from `buildFinancialRows`, period switcher, lag banner.
4. **Screener page:** idx-bei `/v1/screener` builder with FilterBar + saved screens (Supabase `saved_screeners`).
5. **Movers and News & Calendar:** once the idx-bei lane (or a licensed source) is connected.
6. **Insiders and Ownership tabs;** History tab (DataTable over history).
7. **Production readiness:** `/api/ready`, alert job schedule, RLS test run, a distributed rate limiter.

## Slice 1: auth pages and watchlist with quotes
- **Auth** (`src/app/[locale]/(auth)/*`, `components/auth/auth-form.tsx`): login (email/password + Google OAuth), signup (email confirmation), forgot password, reset password. Ported from heulatrade `app/(auth)` and made locale-aware.
  - Supabase error codes map to localized messages; provider text is never shown.
  - Forgot-password always shows the same message, so accounts can't be enumerated.
  - Forms are disabled with an explanation in bypass/unconfigured modes.
- **Redirects:** `safeNextPath` accepts only same-origin, locale-prefixed paths (no `//`, backslashes, foreign locales, or loops back to the auth pages). The proxy adds `?next=` when redirecting anonymous users; `/auth/callback` follows it safely and sends failures to `/{locale}/login?error=auth`.
- **Quotes:** `GET /api/quotes?symbols=A,B` (at most 30, deduplicated, validated). Each symbol succeeds or fails on its own; the envelope is as fresh as the stalest quote (`leastFresh`).
- **Watchlist** (`lib/watchlist.ts`): browser Supabase client, scoped by the existing RLS policies (`watchlists_own`, `watchlist_items_own`). The default list is created on first add. The page has add/remove with validation and a QuoteList with per-row freshness or reason code. The Watch button sits in the stock header; Home's watchlist block shows quotes.
- **Not verified here (needs a configured Supabase project):** real sign-in/up/reset, Google provider setup, redirect URLs (allow `/auth/callback`), and RLS isolation between two users.

## Slices 2–7 (user pre-approved through production readiness, 2026-10-03)
- **S2 Flow:** foreign-flow daily columns + range totals; broker summary (diverging bars + sortable table); broker accumulation (cumulative lines, max 6 brokers). New validated categorical tokens `--series-1..6` skip green/red, which mean up/down. Light mode carries a contrast WARN on 3 slots, mitigated by legend, tooltip and table view.
- **S3 Financials:** statement tables with expand/collapse, empty-row pruning (toggle), reporting-lag banner, per-row chart across periods. Report type, period, row and empty-row toggle are URL state.
- **S4 Screener:** condition builder (URL `?c=`), idx-bei `/v1/screener`. change1D is percent in the UI and converted to a fraction for app.py, both directions tested. Saved screens use Supabase `saved_screeners` (RLS), and Cmd+K `?screen=` loads one. ROE/ROA/dividend-yield units are unverified and shown as plain numbers.
- **S5 Discover:** Movers ranking (gainers/losers need ≥ Rp1 M traded value; active by value) plus largest market caps (arjum). News & disclosures, rendering only http(s) links. Ownership Changes: market-wide feed unavailable (said plainly), stock lookup, insiders across the watchlist.
- **S6 Stock tabs:** Chart (SMA 20/50 overlays + MACD pane, URL `?ind=`); Insiders (paged, action filter); History (daily table, localized seasonality heatmap with values printed in cells, trade tape in lots); Ownership (IDX profile + corporate actions; idx-bei only; record keys TODO(verify)).
- **S7 Production readiness:**
  - Production build/start refuses missing source credentials and non-https provider URLs (`check:prod-guards` covers 6 cases).
  - `/api/ready` reports states only, never secrets.
  - EOD alert job ported (`/api/jobs/evaluate-alerts`, pure `runAlertJob`, EOD-only, idempotent, constant-time secret check, Vercel cron 16:45 WIB).
  - Security headers: CSP limited to self + Supabase, no eval in production, HSTS, frame-ancestors none, nosniff, Referrer-Policy, Permissions-Policy; `X-Powered-By` removed. Production hydration checked: zero CSP violations.
  - Localized error and not-found pages, catch-all 404, global error fallback, skip link, page titles, `robots.txt`.
  - Supabase migration + RLS test copied for reference; CI workflow; README rewritten.
  - A route-level `loading.tsx` was tried and removed: streaming sent 200 before `notFound()`, which broke 404s for invalid tickers.

## Remaining before go-live (needs people, credentials or external decisions)
- Manual arjum check and `bun run record:fixtures` with real credentials.
- Configure Supabase redirect URLs and Google; manual two-user RLS check; run `supabase/tests/rls.sql`.
- Verify the IDX calendar, reporting deadlines, criteria wording, provider record keys (profile) and ratio units.
- Data display rights.
- Optional: CSP nonces, a shared rate limiter.

## S8: alerts management
- `/[locale]/alerts`: create alerts (ticker, measure, condition, threshold in the measure's own unit), turn them on/off, delete them, and list recent triggered events (`alert_events` joined to `alerts`, RLS-scoped).
- Values are formatted per metric (IDR / % / shares / ×). The DB trigger's English notification text is deliberately not displayed.
- Reached from Cmd+K, the account menu, mobile More, and a bell on stock headers (`?symbol=` prefill). Not in the 4-item sidebar, per the init prompt.

## Design system → heulaulab-dashboard (2026-10-03, user request)
The user kept the layout and asked for heulaulab-dashboard's design system:
- `globals.css` holds the dashboard's tokens verbatim: reference CRM dark palette, `--line-strong`/`--subtle`/`--soft`/…, 10 tag tones, power easings, `shadow-overlay`, the 16/14/12 type utilities (`h1-style`, `eyebrow-style`, `caption-style`, …). The HAKAPRO semantic aliases (positive/negative/info/link…) map onto them.
- UI components copied from the dashboard: button (raised pills), input, tabs (underline trigger + TabLabel), dropdown-menu, sheet (plus a HAKAPRO `bottom` side), dialog, tooltip, command (plus a `CommandDialog` matching their command search), select, popover, switch, checkbox, separator, scroll-area, label. Kit: icons, tag, segmented, meter, sparkline. `cn` now uses clsx + tailwind-merge, as there.
- HAKAPRO components restyled to match:
  - Panel (their Section: rounded-xl, 48px eyebrow header) on Home, Movers, Screener and the Ownership tab; ChartCard and InsightCard use the same header bar.
  - Stat tiles (`line-strong` border, 22px semibold value); StatusBadge uses the Tag palette; FreshnessBadge uses the StatusPill shape.
  - ToggleGroup uses the Segmented style; DataTable uses 38px caption headers and 42px rows.
  - Sidebar items, logo block and eyebrow sections; raised-pill search; thin 1.6 icon strokes.
  - Prices and tickers use Geist Sans tabular figures (the reference has no monospace).
- **Exceptions, documented in `globals.css`:**
  - Chart mark colors keep the validated up/down and categorical steps, because the reference's green/red and pastel tag colors fail the colorblind/lightness checks for marks.
  - The `.light` theme is a HAKAPRO companion; the reference is dark-only.
  - Heulau Lab brand assets (logo, pink accent, Syne) are not used.
- **Light mode** now uses the same design language as dark. Every surface effect the components used as a literal (raised and primary shadows, active inset, hover overlays, outline/danger fills, scrims, scrollbars, chevron/checkbox tints) is a theme token in `globals.css`: dashboard values in dark, equivalent soft shadows and overlays in light. ChartCard and InsightCard are built on Panel, so every section shares the same hairline header.

## Real data (arjum, 2026-10-03)
- The user provided the arjum key; it lives only in the git-ignored `.env.local` (mode 600). Dev runs with `MARKET_DATA_SOURCE=arjum` and Supabase copied from heulatrade.
- **Live-API fixes**, none of which the old single sample could reveal:
  - Provider limits (422 above them): insiders ≤15, market-cap ≤50/page, done-details ≤100, history 20–500 rows, accumulation top ≤5. They're centralized in `src/lib/api/provider-limits.ts` and enforced by routes, views, services and the recorder.
  - The cash-flow report_type is `CASH_FLOW_REPORT` (HeulaTrade sent `CASH_FLOW`, which always failed). It's mapped in ArjumSource.
  - The provider's 400/422 now map to `INVALID_REQUEST` and are logged, instead of looking like an outage.
  - History `avg` can be null (SAPX), and a broker-level side can be null (WOOD).
  - Screener `summary` carries a pattern label plus forward-looking stats after an em dash. The parser keeps flags as criteria, shows the pattern label, splits `note` into observation tags, and never shows the ⬆️/⬇️ arrow, win rate, "potensi" or drawdown (§9.5). Provider glitches like "Tbk.)" are logged as `summary_noise`.
- **Drift sweep:** 25 symbols (top 20 market cap plus the screener) × 7 endpoints, 175 requests, 0 schema drift.
- **Recorded fixtures:** `fixtures/arjum/` (73 files, 7 symbols, sanitized, 0 secret matches). Fixture mode prefers them; e2e pins `FIXTURE_DATASET=baseline`. The live screener of 2026-10-02 was added to the baseline for parser tests.
- **Still not live:** the idx-bei lane (movers, news, disclosures, profile, screener builder) needs `MARKET_API_URL`.

## Connection Network — N1 data discovery (2026-10-03)
- Wrote `docs/features/CONNECTION-NETWORK.md` (discovery only, no code). The only live source is arjum insiders: transactions, a name-only entity key, no IDs. arjum has no shareholder, profile or holder-search endpoint (the probes return 403).
- The idx-bei profile has shareholder composition but no data date, and carries NPWP (strip it). The upstream ≥1% ownership snapshot is dated and typed but static and unverified, so it needs a Data Engine.
- Recommendation: Phase 1 = 1-hop from insiders, plus a bounded opt-in overlap (≤10 user-selected symbols). A universe-wide reverse lookup or 2-hop is out of scope and needs a Data Engine.
- Spent 47 live calls, paced; created no crawler, cron or storage. **Stopped at CHECKPOINT N1** for the scope decision.
- **N1 reviewed (2026-10-03): no graph in Phase 1.** `CONNECTION-NETWORK.md` is now the Data Engine spec. The overlap feature is deferred; no paid quota.
- **Insiders tab → Holders view** (default; Transactions is a toggle), `src/lib/insider-holders.ts`:
  - Grouping: organisations merge after legal-form normalisation; people merge only on the exact name and are labelled "identity not verified".
  - Each holder shows the latest disclosed holding with its as-of date, roles as disclosed, and its event history with source.
  - Contradictory same-day results show as Ambiguous with every value. Custodian/nominee accounts are their own kind and are never shown as owners.
  - Older pages load one per user click, and coverage is stated. Checked live on CBRE.
- **Provider conduct** (MIGRATION §10):
  - Honest `PROVIDER_USER_AGENT` on arjum, idx-bei and the recorder.
  - After a 429, the client cooldown sends nothing for Retry-After (clamped 60 s–15 min). The recorder stops on the first 429 and keeps the previous dataset.
  - No probing or crawling.
- **Profile data:** NPWP/NPKP and other ID numbers are stripped in `profileSchema`, with a route-level test. The Ownership tab shows "Retrieved {date} · source {dataset}"; asOf stays null.
- **≥1% list research** is in `CONNECTION-NETWORK.md` → Data Engine inputs: KSEI via monthly IDX announcement PDFs, OJK KDK 1/KDK.04/2026. Commercial reuse needs written permission. Scratch copies of the datasets were deleted; nothing was committed.

## S9: full arjum coverage (2026-10-04, user request "fix all the gaps")
- Every documented arjum REST endpoint and parameter is wired end to end; table in MIGRATION §11. Verified live (15 paced requests for parameters, ~12 through the BFF); quota 1000/day, reported by the provider in `x-ratelimit-*` headers and now surfaced in `/api/ready`.
- Bug fixed: Financials › Annual sent `period=annual`; the provider expects `annually`.
- New: Analysis tab (structured, HAKAPRO wording; decision in MIGRATION §9.5), watchlist Compare analysis (≤5, on demand), today's price in the stock header, broker-summary controls and paired levels, history date range, trade-tape session picker and pages, Financials year/period count, Movers market-cap paging and date, Overview valuation, watchlist market caps.
- Quota care: quotes request today's price only while a trading day is running or just closed; compare runs only on click; market caps for a whole watchlist are one request.
- Fixture mode: price/analysis recorded for BBCA, SAPX, ARCI, DSSA in `fixtures/arjum`; the baseline has the 2026-09-18 BBCA analysis and no price (the header falls back to the daily close).

## S10: landing page (2026-10-04, user request)
- `/{locale}/about` (route group `(marketing)`, no app shell, own scroll container), Indonesian default and English; server-rendered, linked from the sidebar footer, Cmd+K and the mobile More menu.
- Sections: hero with an illustrated stock page (fixed values, labelled "Illustration"), facts, features, data freshness (real FreshnessBadge states, never LIVE), how it works, principles, FAQ, final call to action, footer disclaimer.
- Copy rules: no data vendor is named; no invented testimonials or figures (facts are product facts: 900+ listed companies, daily history from 2020, 8 sections, 2 languages); CTAs follow the auth model (market data needs an account; signed-in users get "Open HAKAPRO").
- 2026-10-04 (user request): the landing page moved from `/{locale}/about` to the locale root `/{locale}`, and the research home moved from `/{locale}` to `/{locale}/dashboard`. Other app URLs are unchanged. Post-login, post-signup and password-reset destinations default to `/dashboard`; sign-out returns to the landing page. This also fixes `/about` being behind the login redirect in production (the proxy only treats `/` and auth pages as public).

## S11: HAKA PRO brand identity (2026-10-04, branch `feat/hakapro-branding`)
- Assets: runtime files in `public/brand/` (svg, png, favicon). Sources (`tokens.json`, guidelines page, generator) in `docs/brand/`, not served publicly.
- Favicon/icons via App Router file conventions (`src/app/favicon.ico`, `icon.svg`, `apple-icon.png`); `src/app/manifest.ts`; `themeColor` follows the theme cookie (Night / Paper).
- Tokens: `--brand-*` + `bg-brand-gradient` in `globals.css`; semantic UI and market tokens unchanged. `tests/unit/brand.test.ts` keeps brand colors out of market/chart/data code.
- `<Logo />` (`src/components/brand/logo.tsx`) in sidebar, mobile header, auth, landing header/footer, 404, error, global-error. Plus Jakarta Sans (`font-brand`) on brand-surface headings only.
- Copy: the brand is written "HAKA PRO" in all UI copy (code identifiers, cookies and the provider user agent stay `HAKAPRO`/`hakapro`). Tagline "Read the market. Follow the flow." in `app.tagline`.
- Indonesian tagline (2026-10-16): "Baca pasarnya. Ikuti arusnya." in `id.json` `app.tagline`. The share image and web manifest keep the English brand line (`BRAND_TAGLINE`) because they are not localized.
- Open: market greens close to brand teal are flagged, not changed (see the branch summary). (`metadataBase` is resolved in S12.)

## S12: environment-aware metadata and landing acceptance (2026-10-16, Plane HAKA-13)
- `metadataBase` follows the deployment: `resolveSiteOrigin()` in `src/server/config/auth.ts` returns the environment's origin (production, staging, develop, or the rehearsal URL), or `BETTER_AUTH_URL` locally. Share images, canonical and hreflang links are absolute on every environment. Before this, canonical links were relative and the share-image URL fell back to the build host.
- Indexing: `isIndexable()` allows only production. Develop, staging and rehearsal send `noindex, nofollow` and a disallow-all `robots.txt`.
- Landing: canonical `/{locale}`, hreflang `id`/`en` plus `x-default` → `/id`.
- Acceptance (e2e, `tests/e2e/landing.spec.ts`): absolute canonical/hreflang/og:image on this origin, and no horizontal overflow on desktop, tablet (820 px) and mobile (Pixel 7) for both locales. The e2e server sets `BETTER_AUTH_URL` to its own origin.
- Indonesian tagline set to "Baca pasarnya. Ikuti arusnya." (see S11).

## S13: Strategy Engine contract (HAKA-18) (2026-10-16, branch `feat/strategy-engine-contract`)
- Contract: `src/lib/strategies/contract.ts` defines Zod 4 schemas shared by the BFF and the UI.
  - `ScreenerStrategy`: id, label, description, source, kind `EOD|REALTIME`, dataAsOf, freshness.
  - `ScreenerCandidate`: symbol, name, strategyId, detectedAt, dataAsOf, freshness, score (nullable), reasons, metrics, source.
  - `source` is one of `ARJUM_SCREENER | HAKAPRO_EOD_ENGINE | HAKAPRO_REALTIME_ENGINE`. The ticket's `HEULATRADE_*` names became `HAKAPRO_*`.
  - Reasons: `criterion` (a key HAKAPRO words, `criteria.<key>`), `unrecognized` (shown, never dropped), and the source's `pattern`/`note` text.
  - Metrics carry `{ key, value: number | null, unit }`. Units are the parse-number units, now `QUANTITY_UNITS` in `src/lib/format`. A missing value renders "—", never 0.
- Engines: `StrategySource` (`context`, `list`, `candidates(strategyId)`) in `src/server/strategies`. The arjum screener adapter (`arjum-screener.ts`) is the only registered source. It maps the `parseStrategyScreen` output and reads the screener once per request.
  - The arjum adapter sets no score and no metrics. The row's win rate, potensi and drawdown are never mapped (§9.5).
  - `HAKAPRO_EOD_ENGINE` and `HAKAPRO_REALTIME_ENGINE` are enum values only, because their rules aren't defined yet (HAKA-17).
- `/api/strategies` now serves `{ contexts, strategies, candidates }` in the usual `{data, freshness, asOf, period?, source}` envelope.
  - The envelope is as fresh as the stalest source and as of the oldest data. With one source, it's the same as before.
  - A strategy id already taken by an earlier source is skipped and logged (`strategy_id_collision`).
- UI: Home, Strategies, Strategy detail, the why-matched drawer, ScreenerTable and the dev primitives read only the contract. Visible output is unchanged.
  - The drawer lists metrics only when an engine sends some, so nothing new shows for arjum.
  - The provider lane (`MarketDataSource.strategies()`, the why-matched parser and its snapshot) is unchanged.

## S14: Ownership change engine + free-float methodology draft (HAKA-33, HAKA-34) (2026-10-16, branch `feat/ownership-engine`)
- Pure domain layer in `src/lib/ownership/`. No UI, no ingestion, and no network. Tests use synthetic fixtures only (`TEST1`, invented holders).
- Snapshot type (Zod 4): rows carry `holderKey`, the disclosed name, kind, integer-string shares, ≤6-decimal percent, position date, and `source {dataset, reference, retrievedAt}`. A snapshot also states its disclosure threshold and, optionally, issued shares. The existing `ownership_snapshots` table doesn't fit; the needed columns and unique-key change are listed in `CONNECTION-NETWORK.md` → "Ownership snapshot type and change engine". No migration was added.
- HAKA-33 `compareOwnershipSnapshots`: NEW / INCREASE / DECREASE / EXIT / UNCHANGED, plus BELOW_THRESHOLD (dropping off the ≥1% list is not a proven exit) and AMBIGUOUS (conflicting duplicate lines). Deltas are exact (BigInt shares, micro-percent pp). Corporate-action flags. Non-adjacent, same-month, reversed and cross-ticker comparisons are refused. Source rows are preserved on both sides.
- HAKA-34 `docs/features/FREE-FLOAT-METHODOLOGY.md` v0.1-draft, **awaiting owner approval** (10 open questions), and `estimateFreeFloat`: strategic / portfolio / unknown rules and an exact low–high range (headline = low). The output is versioned, `isOfficial: false`, and any official figure stays separate.

## S15: Data Engine foundation (E1) (2026-10-16, Plane HAKA-61, branch `feat/engine-foundation`)
- `services/engine/` is a separate Bun + TypeScript service with no Next.js. It shares the idx-bei Zod contract, the IDX calendar and the freshness clock with the app through `@/*`. See `services/engine/README.md` for env vars, local runs and Coolify setup.
- HTTP:
  - `/health` and `/ready` (DB ping, disk at or below threshold).
  - `/v1/meta/health`: per-source status, block reason, last success/error, rows ingested, plus scheduler pause, disk and jobs.
  - Admin (`ENGINE_ADMIN_TOKEN`): run a job, pause/resume, unblock a source.
  - idx-bei `/v1/*` stubs: contract-valid empty envelopes, `UNAVAILABLE`. Quote, profile and signals return `404 NO_DATA` (no fake rows).
  - Optional `ENGINE_API_TOKEN` bearer on `/v1/*`.
  - `tests/unit/engine-idx-bei-contract.test.ts` checks that the app's `IdxBeiSource` parses every stub.
- Engine DB has its own Drizzle schema and migration in `services/engine/db/`:
  - Bookkeeping: `sources`, `raw_documents`, `fetch_runs`, `job_cursors`.
  - Data: `securities`, `daily_prices` (PK symbol+date), `intraday_snapshots` (index symbol+ts), `index_daily`, `announcements`, `news_items` (headline + link only), `corporate_actions`. Each data row carries `source`, `as_of` and `raw_ref`.
  - `bun run engine:db:migrate`, or migrate on start.
- Fetcher:
  - Honest UA; per-host token bucket and concurrency (1 req/2 s, 2 in flight; intraday sources forced to 1).
  - ETag/Last-Modified revalidation and URL+sha256 dedupe, with a raw copy in R2/S3 (`Bun.S3Client`) or a local-directory fallback.
  - A challenge, 403+cf-ray, captcha, login redirect/401 or 429 marks the source `BLOCKED` with evidence and stops it; it is never retried automatically.
  - Backoff applies only to 5xx and network errors. There is no bypass of any kind.
- Scheduler:
  - WIB cron with trading-day skipping, and session-window jobs (every N minutes inside IDX sessions incl. Friday, default 5).
  - Each job is single-flight. Background jobs (2020-01-01 EOD backfill in night batches with a DB cursor; 30-day intraday retention) yield to all other jobs.
  - Global pause above `ENGINE_DISK_STOP_PERCENT` (statfs on the data volume) or while the build/maintenance flag is set.
- Owner decisions applied: one shared engine (Coolify env `data-engine`, app `hakapro-engine`, DB `hakapro-engine-postgres`), R2 bucket `hakapro-engine-raw` (token pending; local fallback works without it), backfill from 2020-01-01, intraday alongside EOD served as DELAYED.
- No real source is registered yet (E2/E3 after discovery). A local fixture source exercises fetch → raw → parse → DB in `bun run engine:test:e2e` (Docker PostgreSQL; not in CI).
- Root `typecheck` now also runs `engine:typecheck`; vitest includes `services/engine/**/*.test.ts`; the root tsconfig excludes `services/engine` (Bun types).

## S16: Data Engine EOD + intraday sources (E2, E2b) (2026-10-16, Plane HAKA-62 + HAKA-67, branch `feat/engine-eod-intraday`, on top of `feat/engine-foundation`)
- Sources, all through the E1 fetcher (honest UA, per-host limits with 1 in flight, raw copies, block detection; no bypass of any kind). All four are unofficial and internal-only (§8.6):
  - TradingView scanner: `indonesia/scan` (whole market, one POST) and `global/scan` (IHSG, LQ45, IDX30 and six IDX-IC sector indices confirmed).
  - Yahoo chart: per-symbol daily OHLCV with `adjclose`, splits, dividends, and IHSG `^JKSE`.
  - Pasardana GetAll: IDX-IC sector/sub-sector/industry, capitalisation, shares, free float, previous-session value and frequency.
  - arjum `/api/history/{code}` for foreign buy/sell (§8.5c), reusing the app's arjum schema, URL builder and page limits. Registered only with `ENGINE_ARJUM_BASE_URL` + `ENGINE_ARJUM_API_KEY`.
- Jobs (WIB):
  - `intraday` every `ENGINE_INTRADAY_INTERVAL_MINUTES` (default 5, minimum 1) inside sessions → `intraday_snapshots` + `index_intraday`, stamped with the data time (10 min delay).
  - `universe` + `indices-eod` at 16:35 → `securities` (board/notation unknown = null), fallback session rows, `index_daily`.
  - `eod-daily` at 16:45/18:45/20:45: Yahoo `range=5d` per active symbol, most liquid first; retries only missing symbols; the 20:45 run finalizes `eod_sessions` as `COMPLETE` or `STALE`.
  - `foreign-flow` at 19:00/21:00: most liquid first, capped by `ENGINE_ARJUM_DAILY_BUDGET` (600) per WIB day and stopped while `x-ratelimit-remaining` < `ENGINE_ARJUM_RESERVE` (400); a 429 blocks the source.
  - `eod-backfill` (night window, background): one Yahoo call per symbol from 2020-01-01, resumable per-symbol cursor; never overlaps the daily job.
- Precedence and fallback: Yahoo owns stock OHLC, TradingView owns index rows; fallback sources fill missing rows and refresh only their own. Universe survives a TradingView or Pasardana block; session rows survive a Yahoo block; IHSG survives a TradingView block. `daily_prices` keeps separate provenance for value/frequency and foreign flow.
- Fetcher: POST bodies (indexed as URL + body hash), a documented credential header that is never stored or redirected, response headers on results. Any 403 now blocks the source.
- New migration: `index_intraday`, `eod_sessions`, intraday OHLC/change, index name/change, securities industry/market cap/free float, and the split provenance columns.
- `/v1` serves stored data through the shared idx-bei schemas: `/v1/securities`, `/v1/stocks/{s}` (EOD quote, or a newer session's intraday snapshot as `DELAYED` with its WIB timestamp; candles up to `limit`), `/v1/market` (indices, breadth, gainers/losers/active), `/v1/signals` (foreign-flow runs) and `/v1/stocks/{s}/actions`. `/v1/meta/health` adds EOD session completeness. News, announcements, fundamentals, screener and profile stay stubs.
- Fixtures: 8 real requests on 2026-10-16 (TradingView 3, Pasardana 2, Yahoo 3), no block; trimmed responses in `services/engine/test/fixtures/`. arjum is a fake (no credentials used).
- Tests: parser, fetcher, config, backfill, `/v1` derivation and route unit tests; the app contract test parses real engine responses through `IdxBeiSource`; `bun run engine:test:e2e` runs every job, the block/fallback/budget paths and universe → EOD → foreign → intraday → `/v1` against Docker PostgreSQL and a local fixture world.
- Not done (E3 and later): news RSS, BI-Rate/JISDOR macro, `/v1/news`, fundamentals/screener (E5), disclosures and board/notation (blocked at IDX), ownership upload (E6), strategy scans (E4). The engine is not deployed; no environment points `MARKET_API_URL` at it yet.

## S17: Data Engine market info (E3) (2026-10-16, Plane HAKA-63, branch `feat/engine-market-info`)
- Sources, all through the existing fetcher (honest UA, raw copies, block detection → `BLOCKED` and stop; no bypass, UA change or proxy), each 1 request / 5 s per host, 1 in flight:
  - News RSS (§5.7 OK feeds): `news-cnbcindonesia` (market), `news-detik` (finance), `news-antara` (ekonomi-bursa), `news-investortrust` (market + macro feeds on one source).
  - `bank-indonesia`: the BI-Rate and JISDOR HTML tables, first page only (no ASP.NET postback paging).
- Jobs (WIB): `news` every `ENGINE_NEWS_INTERVAL_MINUTES` (15, minimum 5) from 06:00 to 22:00 every day with conditional GET; `news-retention` 02:45 (`ENGINE_NEWS_RETENTION_DAYS`, 180); `macro-jisdor` 17:00 and `macro-bi-rate` 17:05 daily. A new `window` scheduler trigger; retention jobs share one helper.
- News rows: headline, canonical link (unique), time (RSS/Atom dates with zones; fetch time + `published_at_estimated` as the fallback), outlet, a ≤ 280-char plain summary only from the feed's own description, matched symbols (`$SYMBOL` or known bare tickers outside a stoplist and outside all-caps text). Title dedupe across outlets within 3 days. Never article bodies or article pages.
- Migration: `news_items` gains `summary`, `title_key`, `published_at_estimated` (+ GIN symbol index); new `macro_observations` (series, date, value, link, provenance).
- `/v1/news?page&page_size[&symbol]` (newest first; `newsItemSchema` gains optional `outlet`, `symbols`, `dateEstimated`), `/v1/macro` (new shared `macroSchema`, `IdxBeiSource.macro()`, no UI), `/v1/actions?from&to` (market-wide ex-date calendar, `actionsCalendarSchema`). `/v1/announcements` stays the empty `UNAVAILABLE` form; `/v1/meta/health` now lists unavailable routes and why (idx.co.id blocked).
- The app's news panel (home and `/news`) populates from `/v1/news` through the existing `IdxBeiSource.news()` without app changes.
- Fixtures: 7 real requests on 2026-10-16 14:27–14:28 WIB (5 feeds, 2 BI pages), no block; trimmed to 3 items/rows in `services/engine/test/fixtures/`.
- Tests: RSS/Atom, date, HTML-stripping, canonical-link, symbol and BI-table parser tests; window trigger and route tests; the app contract test parses `/v1/news` and `/v1/macro` via `IdxBeiSource`; the e2e covers the news and macro jobs (spacing, 304s, dedupe, blocks, retention) and the new routes.
- Not done: BPS macro (key needed, §8.7), disclosures (blocked at IDX), record/payment dates and rights (no open source), any app UI for macro or the calendar.

## S18: Data Engine strategy scans (E4, draft rules) (2026-10-16, Plane HAKA-64, branch `feat/engine-strategy-scans`)
- **Draft rules.** The rules are STRATEGY-RULES.md DRAFT v0.1 (PR #4, branch `docs/strategy-rules`, not approved). Everything is gated and off by default: `ENGINE_STRATEGY_SCANS_ENABLED` on the engine (no job, empty `/v1/strategies`), `STRATEGY_ENGINE_ENABLED=1` in the app. No UI changes.
- Engine rules (`services/engine/src/strategies/`): pure, deterministic functions with one frozen parameter object (`STRATEGY_RULES`, `rulesVersion: "0.1-draft"`, the draft's defaults unchanged).
  - Gate G: G1 traded on t; G2 60 sessions; G3 18/20 traded; G4 20-session average value ≥ Rp 1 bn; G5 close ≥ Rp 100; G6 consistent OHLC on every row read; G7 board/notation; G8 split ex-date.
  - BREAKOUT (§4) and BB REVERSAL (§5).
  - Board and notation are unknown (no source), so every candidate carries `boardKnown = 0` and a note; it is never treated as the main board. Value falls back to close × volume (as in the draft's tables) when a row has no session value.
- Tests: the draft's synthetic cases are ported (BO+1, BO−1…BO−5; BB+1, BB−1, BB−2, BB−4, BB−5 with the draft's band values and %B), plus boundary, gate and wording tests. Draft issues are noted for the owner, not fixed:
  - BB Inputs ask for ≥ period + W + 1 rows (14 at period 10), but the BB table has 13 rows (D-12..D0). The rule is kept; the tests add one flat leading row that no band reads, and a test pins that the bare 13-row table fails the input rule.
  - "With period 5 and k = 2 … the maximum z-score of 5 samples is 1.79": that is the sample-σ bound. With the draft's population σ it is √(n − 1) = 2. The conclusion still holds: a close can at most touch the band.
  - Interpretations: G3's "last 20 sessions" excludes t (§3.1 lookbacks); with several pierces, the most recent one with a meaningful band is reported (rule 2 fails only when every pierce had a narrow band); the BB tables give no volumes, and BB−5 gives only closes for D-3..D-1; the HAKA-18 criterion has no parameters and no `rulesVersion` (Q-G7), so the numbers and dates go into notes and the version into the context, a note and the DB.
- Job `strategy-scan-eod`: 21:00 and 23:00 WIB on trading days, or `POST /v1/admin/jobs/strategy-scan-eod/run`. It scans the last completed session over the whole active universe only when `eod_sessions` is `COMPLETE`, otherwise it records `SKIPPED` with the reason. It reads stored rows only and calls no source.
- New migration (`20261016093924_strategy_scans`): `scan_runs` (one per session + rules version: status, skip reason, parameters, universe counts, gate failures, misses, source `HAKAPRO_EOD_ENGINE`, as-of) and `scan_candidates` (strategy, symbol, session, rules version, rank, reasons, metrics, source, as-of). No other table changed.
- `/v1/strategies`: the HAKA-18 board (`strategyBoardSchema`), score null, `criterion`/`note` reasons, metrics with units. `/v1/meta/health` gains `strategyScans` (flag, rules version, built and `NOT_BUILT` strategies with reasons, last runs) and lists `/v1/strategies` as `DISABLED` while the flag is off.
- Contract: new `ENGINE_CRITERION_KEYS` (`closeAboveHigh`, `relativeVolume`, `closeLocation`, `firstBreak`, `closedBelowBand`, `backInsideBand`, `bullishCandle`) with en/id wording, metric labels, and a `ratio` quantity unit.
- App: `IdxBeiSource.engineStrategies()` and `engineStrategySource` (ids `eod-breakout`, `eod-bb-reversal`, after arjum). An unreachable engine contributes nothing, and the board's freshness counts only sources that contribute a strategy.
- Not built: ARA HUNTER, HAKA SORE/BSJP, HAKA PAGI and SCALPING INTRADAY (HAKA-25 tick/limit rules, HAKA-14/15 Running Trade). Not done: owner approval of the rules, deployment, any UI for draft labelling beyond the candidate note.

## S19: Data Engine fundamentals + screener (E5) (2026-10-16, Plane HAKA-65, branch `feat/engine-fundamentals`)
- Source `yahoo-fundamentals` (Yahoo fundamentals timeseries, §5.5): one GET per symbol with 26 statement lines × annual/quarterly (revenue, gross profit, operating/pretax/net income, EBITDA, EPS, average shares, total assets/liabilities, parent and total equity, debt, cash, current assets/liabilities, shares outstanding/issued, operating cash flow, capex, free cash flow, dividends paid). Same host as the chart, so the existing per-host limiter spaces both (1 in flight, 3 s); its own source id for health. A 429 on either path stops both.
- Jobs (WIB): `fundamentals` every 10 min at :05 from 19:00 to 05:59, a new **low-priority background** job (never starts while any other job runs, yields at the next symbol when one does), 20 symbols per run, most liquid first; weekly full cycle (ISO week, cursor in `job_cursors`, resumable) plus an earnings-season catch-up (Thu–Sun inside 15 Mar–10 May, 15 Jul–10 Aug, 15 Oct–10 Nov) for symbols missing the expected quarter. `ratios` at 06:15, 17:15 and 21:15 (no network). `universe` now also stores Pasardana's `Per`/`Pbr`/`Roe` (no extra request).
- Migration: `financials` (symbol, period_end, period_type annual|quarterly, metric, value, unit amount|per_share|shares, currency, source, as_of, raw_ref) and `stock_ratios` (symbol, ratio, ratio_source derived|pasardana, value, date, basis, note, inputs, derivation, computed_at, provenance). Nothing else changed in the schema.
- Ratios (`src/derive/ratios.ts`, version `ratios-v1`): NI TTM = four consecutive quarters, else last annual + YTD − prior-year YTD (Yahoo skips quarters, e.g. BBCA Q3-2025), else annual; EPS = NI × fx / shares; PER = price / EPS (null when EPS ≤ 0); PBV = price / (equity × fx / shares) (null when equity ≤ 0); ROE = NI / equity; ROA = NI / assets; DER = liabilities / total equity (null when ≤ 0); dividend yield = 365-day ex-date dividends per share / price (a true 0 when the price history covers the window), else |dividends paid TTM| / market cap. USD filers convert with JISDOR. Inputs older than 550 days are missing. Fractions for ROE/ROA/yield.
- Precedence: a `derived` row (even a deliberate null) wins; Pasardana's own ratio is used only where no derived row exists; never blended. The screener response names the source per symbol and field (`ratioSources`, an optional field added to the shared `screenResultSchema`).
- `/v1/stocks/{s}/fundamentals`: one entry per (period end, ANNUAL|QUARTERLY), newest first, with `units`, `currency`, `source` (optional fields added to `fundamentalsSchema`); `dataAsOf` = newest period end, `HISTORICAL`. `POST /v1/screener`: every SCREEN_FIELD over the newest session, conditions (≤ 20; AND binds tighter than OR; a null never matches), limit, total, `supportedFields` = fields with any value; gaps are null, never 0. Both dropped from `/v1/meta/health` `unavailable`.
- App: the Screener page (`/discover/screener`, POST `/api/screener` → `IdxBeiSource.screen`) populates without app changes once `MARKET_API_URL` points at the engine (arjum has no screener). `/api/stocks/{s}/fundamentals` populates too, but no UI reads it: the Financials tab uses arjum's financial statements and is unchanged.
- Fixtures: 3 real requests on 2026-10-16 15:24–15:25 WIB (BBCA, TLKM, GOTO fundamentals; ≥ 15 s apart, honest UA, no retries), all 200, no block; trimmed to 13–15 lines each.
- Tests: parser/mapping, hand-computed ratio cases (4q/YTD TTM, negative equity, zero and negative earnings, missing inputs, USD/JISDOR, dividend fallbacks, BBCA fixture), condition evaluation and precedence, low-priority scheduling, contract tests through `IdxBeiSource` for both routes, and e2e (job order and spacing, weekly + catch-up cycles, 429 → both Yahoo sources blocked, ratios → `/v1` routes).
- Not done: TTM/derived ratios inside `/fundamentals` periods, statement history beyond Yahoo's window (~4 years + 5 quarters, accumulating from now on), the app's ROE/ROA/yield labels (still "units unverified"; the engine sends fractions), IDX XBRL statements (blocked).

## S20: Data Engine ownership upload (E6) (2026-10-16, Plane HAKA-66, branch `feat/engine-ownership`)
- Owner decision §8.5d applied: idx.co.id and KSEI block the engine, so the owner downloads the monthly KSEI ≥1% list and uploads it. No fetcher, job or request to IDX/KSEI exists.
- Admin routes (`ENGINE_ADMIN_TOKEN`): `POST /v1/admin/ownership/upload?asOf=YYYY-MM[&source][&snapshotDate][&filename]` (raw PDF/CSV/XLSX body or multipart `file`), `GET /v1/admin/ownership/uploads`, `POST /v1/admin/ownership/uploads/{id}/reparse`.
  - Size cap `ENGINE_OWNERSHIP_MAX_UPLOAD_MB` (20) from Content-Length and the streamed body; Bun's body limit and idle timeout follow it.
  - The original goes to the raw store (source `ownership-upload`, sha256 dedupe: same bytes → `duplicate`, another month → `409`).
  - `ownership_uploads` status `RECEIVED` → `PARSED` / `FAILED` with the error, per-row issues (capped at 500) and stats (header columns found, rows accepted/rejected, sets replaced, changes, parser version).
- Parsing (`services/engine/src/ownership/`):
  - One parser interface for PDF (unpdf text items with positions → lines → header-driven columns, two-line headers, wrapped names, repeated or missing page headers, footers) and CSV/XLSX (fflate; percent and date cell formats).
  - Indonesian and English share/percent formats and Indonesian month names, parsed exactly as strings.
  - Per-row validation errors are collected and the row skipped; only a missing header, missing position date, date outside `asOf` or zero valid rows fails the upload.
  - Holder kind from the stated investor type plus the existing name rules (custodian/nominee, government, public aggregates); HAKA-33 holder keys; unused columns (nationality, domicile, addresses, identifiers) dropped at parsing.
  - The column layout (`layout.ts`) follows CONNECTION-NETWORK.md §1.3; no real PDF has been seen, so it must be checked (and adjusted there) on the first real upload, then re-parsed.
- Storage (migration `20261016091201_ownership_uploads`, ownership tables only): `ownership_uploads`, `ownership_snapshot_sets` (one per symbol and month; dataset, threshold, issued shares, source reference, retrieved at, raw ref, comparison, draft free float), `ownership_snapshot_rows` (holder key/kind, exact `numeric` shares and percent, investor type, local/foreign, unique per line reference so duplicate published lines are kept), `ownership_changes` (HAKA-33 output with derivation version and line references).
- Derivations: after each parse, `compareOwnershipSnapshots` against the previous month when adjacent (otherwise `NOT_ADJACENT`); an earlier month uploaded later re-derives the next one. `estimateFreeFloat` is stored with `methodologyStatus: "draft"` and served only with `ENGINE_FREE_FLOAT_ENABLED=1` (default off).
- `/v1/stocks/{s}/ownership` and `/v1/ownership/changes?month=YYYY-MM[&symbol]`, `HISTORICAL` by position date, validated with the new shared `src/server/schemas/ownership.ts`; `IdxBeiSource.ownership()` and `.ownershipChanges()` (no UI).
- Synthetic fixtures only (`TEST1`–`TEST4`, invented holders): two PDF months, a CSV, and generated XLSX/PDF variants from `services/engine/test/ownership-fixtures.ts` and a minimal PDF writer.
- Tests: number/date parsing, PDF/CSV/XLSX parsers and validation errors, the upload service (two months of changes, out-of-order months, non-adjacent months, re-upload replacement, dedupe, failure, re-parse), routes (auth, size, dedupe, 415/422/503, contracts, free-float flag), the app contract test via `IdxBeiSource`, and a Docker e2e (`e2e-ownership.test.ts`). The engine image builds with unpdf bundled and parsed both synthetic PDFs in a container.
- Upload procedure and network note in `services/engine/README.md` → Ownership uploads: the engine has no public domain; uploads go from the Coolify server's private network until the owner decides on an admin-only route.
- Not done: any UI; the reverse holder lookup and alias table; licence for public use (CONNECTION-NETWORK.md → Data Engine inputs).
