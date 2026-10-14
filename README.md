# HAKAPRO

Market intelligence and stock research for Indonesian equities (IDX). HAKAPRO is for research and decision support. It does not execute trades.

**Flow:** Discover → understand why → research the stock → the user decides.

The application uses Next.js 16 App Router, private PostgreSQL with Drizzle, and Better Auth for Google plus email/password. Market providers stay behind the server BFF. The migration branch removes the former Supabase runtime; production cutover remains a separate operation. See [migration status](docs/MIGRATION.md), [progress](docs/PROGRESS.md), and [source import procedure](docs/migrations/source-data-import.md).

## Local development

```sh
bun install --frozen-lockfile
cp .env.example .env.local
bun run dev --port 3200
```

For local fixture browsing, set `DEV_AUTH_BYPASS=1`. The bypass opens market routes only; persistent user data still requires a real Better Auth session and a local PostgreSQL database. Fixtures show **FIXTURE DATA**; bypass shows **AUTH BYPASS**. Production rejects both. To develop auth/data flows, provide local `DATABASE_URL`, `BETTER_AUTH_SECRET` (at least 32 characters), and `BETTER_AUTH_URL=http://localhost:3200`, then apply migrations with `bun run db:migrate`.

Set `MARKET_DATA_SOURCE=arjum` and its server URL/key for real market data. `bun run record:fixtures` refreshes sanitized provider fixtures. Never commit `.env.local` or credential values.

## Environment

All credentials below are server-only runtime settings in Coolify. No database/auth/provider secret belongs in a `NEXT_PUBLIC_*` variable or build argument.

| Variables | Production requirement |
| --- | --- |
| `DATABASE_URL` | Private URL for Hakapro PostgreSQL; use its own resource, never Dashboard PostgreSQL |
| `BETTER_AUTH_URL` | `https://hakapro.heulaulab.xyz` |
| `BETTER_AUTH_SECRET` | Random secret of at least 32 characters |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Both required; register `https://hakapro.heulaulab.xyz/api/auth/callback/google` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Complete set required for email/password, verification and password reset; `/api/ready` fails production readiness if absent |
| `SMTP_SECURE` | Optional `1` or `0`; default follows port 465 |
| `MARKET_DATA_SOURCE` | `arjum` or `idx-bei`; fixtures rejected |
| `HEULATRADE_MARKET_API_BASE_URL`, `HEULATRADE_MARKET_API_KEY` | Required for arjum; HTTPS URL |
| `MARKET_API_URL` | Required for idx-bei; optional supplemental lane for arjum; HTTPS URL |
| `ALERT_JOB_SECRET` | Runtime bearer secret for the alert evaluator |
| `DEV_AUTH_BYPASS` | Unset in production |
| `E2E_RATE_LIMIT_SCALE` | Local e2e only; ignored in production |

A rehearsal deployment also runs with `NODE_ENV=production`. Set `BETTER_AUTH_ENVIRONMENT=rehearsal` and both `BETTER_AUTH_URL` and `BETTER_AUTH_REHEARSAL_URL` to the same distinct HTTPS rehearsal origin. Register its own Google callback and use only rehearsal DB credentials. Live production leaves the environment selector unset/default production.

`next build` / `next start` reject unsafe market/auth config. The Dockerfile uses compile-only placeholders in the build process so real credentials stay runtime-only. It has no public auth build variables. Build placeholders are not a deployable runtime configuration.

## Commands and architecture

| Command | Purpose |
| --- | --- |
| `dev`, `build`, `start` | Next.js development, build, runtime |
| `typecheck`, `lint` | Route types/TypeScript and ESLint |
| `db:generate`, `db:migrate` | Generate/version and apply Drizzle migrations |
| `test`, `test:e2e` | Existing unit and browser suites |
| `build:check` | Compile-only production placeholders; never serve its output with those settings |
| `check:prod-guards`, `check:server-boundary` | Existing build guard checks |
| `verify` | Runs static checks, existing tests and build guards |

Auth handlers live under `/api/auth/[...all]`; session lookup is server-side. User-owned actions call `requireUser()` and PostgreSQL repositories scoped by the session UUID. Browser adapters call those actions without direct database access. Market API responses use `{data, freshness, asOf, period?, source}`. Providers, DB, auth and mail modules use `server-only`; the CSP limits browser connections to the application origin. Freshness is never fabricated, and locale-aware formatters retain explicit units.

## Coolify deployment and migration

Use the reviewed migration commit from private repo `heulaulab-dev/hakapro`, `/Dockerfile`, container port `3000`, and HTTPS domain `hakapro.heulaulab.xyz`. Apply runtime settings above to the app; disable any legacy Supabase build/runtime variables during the coordinated cutover. Keep the known-good deployment available until cutover is accepted.

[Resource inventory](docs/migrations/coolify-resources.md) records separate private PostgreSQL 17 databases: production `hakapro-postgres`, rehearsal `hakapro-rehearsal-postgres`. Each has its own persistent volume/password. Daily local backup schedules retain seven copies; offsite recovery and a restore drill remain required operational work. Never import into the existing Dashboard database.

Apply [versioned schema migrations](docs/migrations/postgres-schema.md) with the controlled private runner. Then follow the [private snapshot import and native-column reconciliation procedure](docs/migrations/source-data-import.md). Rehearsal import of the retained snapshot succeeded with zero mismatches; it does not replace the final frozen-source snapshot. Before production writes move, freeze all source writers, make recoverable source/target backups, import the fresh snapshot into an empty production target through reviewed target controls, and require zero mismatches plus auth/data/job smoke checks. Retained Google UUIDs/subjects survive; old sessions are invalidated. Bucket objects were empty in the rehearsal snapshot; any new objects require reviewed private transfer before cutover.

Rollback to the previous deployment is straightforward only before PostgreSQL accepts new writes. After new writes, review and reconcile those changes before changing routing back. Preserve the source project and recovery backups through stabilization.

The server's scheduled-task timezone is UTC. Configure `evaluate-alerts` at `45 9 * * 1-5`, timeout 300 seconds, after the PostgreSQL job smoke check. It calls the same application's internal endpoint and uses only the runtime job secret:

```sh
node -e 'fetch("http://127.0.0.1:3000/api/jobs/evaluate-alerts", { method: "POST", headers: { authorization: "Bearer " + process.env.ALERT_JOB_SECRET } }).then(async (response) => { console.log(await response.text()); if (!response.ok) process.exitCode = 1; }).catch(() => { console.error("ALERT_JOB_UNREACHABLE"); process.exitCode = 1; })'
```

`/api/health` is process liveness and never checks credentials/database. `/api/ready` returns 200 only when required auth/provider/email configuration, PostgreSQL connectivity and market health are ready; otherwise 503 with state codes. Google/SMTP checks confirm configured settings; real OAuth and email delivery still require operational smoke checks.
