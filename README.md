# HAKAPRO

Market intelligence and stock research for Indonesian equities (IDX). HAKAPRO is for research and decision support. It doesn't execute trades and never shows buy/sell signals.

**Flow:** Discover → understand why → research the stock → the user decides.

It replaces the HeulaTrade terminal UI with a dashboard (Next.js 16, App Router), reusing HeulaTrade's ported API layer and its existing Supabase Auth. See `docs/MIGRATION.md` for what was ported and `docs/PROGRESS.md` for the build log.

## Quick start (local, fixture data)

```bash
bun install
cp .env.example .env.local      # then set DEV_AUTH_BYPASS=1 for local browsing without Supabase
bun run dev --port 3200         # open http://localhost:3200 (use localhost, not 127.0.0.1)
```

With no `MARKET_DATA_SOURCE`, the app serves recorded provider responses from `fixtures/` and shows a persistent **FIXTURE DATA** banner. `DEV_AUTH_BYPASS=1` shows **AUTH BYPASS**. Production refuses both.

To use real data, set `MARKET_DATA_SOURCE=arjum` plus `HEULATRADE_MARKET_API_BASE_URL` and `HEULATRADE_MARKET_API_KEY` in `.env.local`. To refresh the fixtures from the real provider, run `bun run record:fixtures` (it strips keys, hosts and order numbers).

## Environment

| Variable | Scope | Required in production |
| --- | --- | --- |
| `MARKET_DATA_SOURCE` | server | yes: `arjum` or `idx-bei` (`fixture` is rejected) |
| `HEULATRADE_MARKET_API_BASE_URL`, `HEULATRADE_MARKET_API_KEY` | server (secret) | yes for `arjum`; https only |
| `MARKET_API_URL` | server | yes for `idx-bei`; optional with `arjum` (fills movers, news, profile, screener); https only |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | server (secret) | for the alert job |
| `ALERT_JOB_SECRET` / `CRON_SECRET` | server (secret) | for the alert job (manual / Vercel Cron) |
| `DEV_AUTH_BYPASS` | dev only | must be unset (`1` is rejected) |
| `E2E_RATE_LIMIT_SCALE` | e2e only | ignored in production |

`next build` and `next start` **exit with an error** when production configuration is unsafe: fixture data, a missing source or credentials, non-https provider URLs, missing Supabase config, or the auth bypass. `bun run check:prod-guards` proves each case.

## Scripts

| Script | What it does |
| --- | --- |
| `dev`, `build`, `start` | Next.js |
| `typecheck`, `lint`, `test` | TypeScript, ESLint, Vitest (unit; fixtures only) |
| `test:e2e` | Playwright on desktop/tablet/mobile against the dev server in fixture + bypass mode |
| `check:prod-guards` | production builds are refused for each unsafe config |
| `check:server-boundary` | importing `src/server/**` into a client component fails the build |
| `build:check` | production build with placeholder config; **for verification only, never deploy its output** |
| `verify` | all of the above except e2e |
| `record:fixtures` | records provider responses into `fixtures/arjum/` (needs real credentials) |

## Architecture

```
src/
  app/[locale]/(app)/      dashboard: Home, Discover (Screener, Strategies, Movers, Ownership Changes),
                           Watchlist, News & Calendar, stock/[symbol]/{overview,chart,flow,financials,ownership,insiders,history}
  app/[locale]/(auth)/     login, signup, forgot/reset password (Supabase Auth)
  app/api/                 BFF route handlers. Every response is a freshness envelope:
                           { data, freshness, asOf, period?, source }
  server/                  server-only: providers (arjum, idx-bei, fixture) behind MarketDataSource,
                           Zod schemas at every provider boundary, pure domain services (tested)
  lib/                     format (locale-aware units), freshness, query keys, client API contracts
  components/              ui (shadcn), data, market, charts, feedback, layout
  i18n/                    next-intl: id (default), en
```

- **Freshness is never faked.** States are LIVE / DELAYED / EOD / HISTORICAL / STALE / UNAVAILABLE. The IDX session calendar (`src/server/config/idx-calendar.ts`) classifies data dates, choosing the less fresh label when uncertain. Fixtures are capped at HISTORICAL.
- **Numbers:** one formatter (`src/lib/format`). Indonesian "M" = miliar, English "M" = million, so suffixes come from explicit tables. Volume always shows its unit (lembar/lot).
- **Auth fails closed:** market routes require a Supabase session; a missing env var never opens access.
- **Charts:** TradingView Lightweight Charts for prices (attribution in `THIRD_PARTY_NOTICES.md`); Recharts for the rest. Colors were validated for colorblind separation and contrast.

## Deploying (Vercel)

1. Set the production environment variables above, on the server side only, except the two `NEXT_PUBLIC_SUPABASE_*`.
2. In Supabase Auth settings, allow `https://<domain>/auth/callback` as a redirect URL, and enable the Google provider if you use it.
3. `vercel.json` schedules the EOD alert job weekdays at 09:45 UTC (16:45 WIB). Set `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY`.
4. Point uptime checks at `/api/ready`: 200 when auth and the market provider are healthy, 503 with state codes otherwise. `/api/health` is liveness only.

### Production checklist (open items)
- [ ] Verify the IDX trading schedule and the 2026+ holiday calendar (`src/server/config/idx-calendar.ts`).
- [ ] Verify the OJK/IDX reporting deadlines (`src/server/config/reporting.ts`).
- [ ] Confirm the criteria wording with the screener provider (`docs/GLOSSARY.md`).
- [ ] Run `supabase/tests/rls.sql` on a test database; manually test sign-up, sign-in and a two-user watchlist.
- [ ] Market-data display rights for the provider data.
- [ ] Optional hardening: CSP nonces instead of `'unsafe-inline'` scripts; a shared rate limiter (the current one is per instance).
