# HAKAPRO — Progress

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
- TODO (user): Indonesian translation of the tagline. `id.json` `app.tagline` holds the English text until then.
- Open: root `metadataBase` is unset (Vercel falls back to `VERCEL_PROJECT_PRODUCTION_URL`; elsewhere set it). Market greens close to brand teal are flagged, not changed (see the branch summary).
