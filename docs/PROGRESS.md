# HAKAPRO — Progress

| # | Checkpoint | Status | Commit |
| --- | --- | --- | --- |
| 1 | Inventory (`docs/MIGRATION.md`) | ✅ approved 2026-10-03 with corrections (MIGRATION §9) | — |
| 2 | Scaffold: typecheck / lint / build pass | ✅ approved 2026-10-03 | a46b4fc |
| 3 | Data layer ported, fixture-backed `MarketDataSource`, unit tests | ✅ approved 2026-10-03 | 11cce02 |
| 4 | Foundations: i18n, format module, tokens, FreshnessBadge | ✅ awaiting approval | see git log |
| 5 | App shell | ⏳ | |
| 6 | Primitives | ⏳ | |
| 7 | Vertical slice: Home → Strategies → Why matched → Stock Overview | ⏳ | |

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
- **Run it yourself:** `bun run record:fixtures` (optionally `-- --limit 10`). It needs `HEULATRADE_MARKET_API_BASE_URL` and `HEULATRADE_MARKET_API_KEY` in `.env.local`. It records the strategy screener, every matched symbol (25 at most by default) plus BBCA, and for each symbol: broker summary and accumulation, history (daily, 120 rows), seasonality, three quarterly financial statements, insiders and trade details. It also records market cap, health and per-symbol search. Analysis text is skipped.
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
