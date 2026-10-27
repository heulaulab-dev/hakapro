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
| `BETTER_AUTH_URL` | `https://hakapro.id` |
| `BETTER_AUTH_SECRET` | Random secret of at least 32 characters |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Both required; register `https://hakapro.id/api/auth/callback/google` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | Complete set required for email/password, verification and password reset; `/api/ready` fails production readiness if absent |
| `SMTP_SECURE` | Optional `1` or `0`; default follows port 465 |
| `MARKET_DATA_SOURCE` | `arjum` or `idx-bei`; fixtures rejected |
| `HEULATRADE_MARKET_API_BASE_URL`, `HEULATRADE_MARKET_API_KEY` | Required for arjum; HTTPS URL |
| `MARKET_API_URL` | Required for idx-bei; optional supplemental lane for arjum (the Data Engine). HTTPS URL, or `http://<service-name>:<port>` to an internal Coolify service (no dots), e.g. `http://hp7pevthvpqki0eyqxkqpwu4:8080` for the shared `hakapro-engine` |
| `ALERT_JOB_SECRET` | Runtime bearer secret for the alert evaluator |
| `AI_FEATURES_ENABLED`, `ANTHROPIC_API_KEY` | Optional. AI features are off unless both are set (`1` and a runtime-only Claude API key). See [AI features](#ai-features) |
| `AI_MODEL_NARRATIVE`, `AI_MODEL_COPILOT`, `AI_DAILY_REQUEST_LIMIT` | Optional AI overrides (defaults `claude-opus-5-5`, 20 requests per user per day) |
| `DEV_AUTH_BYPASS` | Unset in production |
| `E2E_RATE_LIMIT_SCALE` | Local e2e only; ignored in production |

## Environments and branches

Three long-lived branches each deploy to their own Coolify app, built from the same `/Dockerfile`. Every deployment runs `NODE_ENV=production`, so all production guards apply everywhere; `BETTER_AUTH_ENVIRONMENT` selects which origin `BETTER_AUTH_URL` must equal (`src/server/config/auth.ts`, `DEPLOYMENT_ORIGINS`).

| Branch | Environment | `BETTER_AUTH_ENVIRONMENT` | Origin | Database |
| --- | --- | --- | --- | --- |
| `develop` | develop | `develop` | `https://dev.hakapro.id` | own PostgreSQL, test data only |
| `staging` | staging | `staging` | `https://staging.hakapro.id` | own PostgreSQL, test data only |
| `main` | production | unset (`production`) | `https://hakapro.id` | `hakapro-postgres` |

- **Flow:** feature branches open PRs into `develop`; `develop` → `staging` for acceptance; `staging` → `main` releases to production. CI runs on pushes to all three and on every PR. Don't commit directly to `staging` or `main`.
- **Isolation:** each environment has its own database, `BETTER_AUTH_SECRET` and `ALERT_JOB_SECRET`. Never point develop or staging at the production database or copy production user data into them.
- **Google OAuth:** register `<origin>/api/auth/callback/google` for each environment (one OAuth client may list all three redirect URIs).
- **Market data:** arjum allows 1000 requests per day per key, shared by every environment using that key. Schedule the `evaluate-alerts` job on production only; run it by hand elsewhere.
- **Indexing:** `robots.txt` disallows everything outside production.
- **Rehearsal:** the migration-only deployment (`hakapro-rehearsal`) sets `BETTER_AUTH_ENVIRONMENT=rehearsal` and both `BETTER_AUTH_URL` and `BETTER_AUTH_REHEARSAL_URL` to its own HTTPS origin, with rehearsal DB credentials only. It is removed after the production cutover.

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

## AI features

Off by default. They turn on only when `AI_FEATURES_ENABLED=1` **and** `ANTHROPIC_API_KEY` are set at runtime (Coolify secret; no rebuild needed). Without them the app behaves exactly as before: no AI UI is rendered, no request reaches Anthropic, and the AI routes answer `503 AI_NOT_CONFIGURED`. Research and options: [docs/research/2026-10-21-ai-features.md](docs/research/2026-10-21-ai-features.md).

| Route | What it does |
| --- | --- |
| `GET /api/research/[code]/narrative?lang=id\|en` | 3–5 neutral sentences phrasing the Research Brief. Shown only if every number traces to the brief (number validator) and no advice wording appears; cached per ticker, session and language |
| `POST /api/ai/copilot` | **Prototype.** Tool-use chat over six read-only data tools; NDJSON stream with citations (tool + as-of). Opened from the header ("Ask Copilot") |
| `GET /api/ai/health[?probe=1]` | Admin only. Whether AI is configured, models, limits; `probe=1` checks the key with a Models API lookup. Never returns the key |

Each signed-in user gets `AI_DAILY_REQUEST_LIMIT` (default 20) AI requests per Jakarta day, counted **in memory per process** (resets on restart; move it to PostgreSQL before running more than one instance). Failed, rejected or retracted answers are not charged. Logs carry token counts and outcome codes only, never prompts or answers.

```sh
# Copilot from a signed-in session (copy the session cookie from the browser):
curl -N "$HAKAPRO_ORIGIN/api/ai/copilot" \
  -H 'content-type: application/json' -H "cookie: $HAKAPRO_SESSION_COOKIE" \
  -d '{"lang":"id","messages":[{"role":"user","content":"Berapa harga terakhir BBCA dan arus asing 5 hari terakhir?"}]}'
# {"type":"tool","tool":"get_research_brief","code":"BBCA"}
# {"type":"text","text":"..."}        <- draft until "done"; a "retract" event means hide it
# {"type":"done","citations":[{"tool":"get_research_brief","code":"BBCA","asOf":"...","source":"..."}],"charged":true,"refusal":false}
```

## Coolify deployment and migration

Production deploys branch `main` of `heulaulab-dev/hakapro` with `/Dockerfile`, container port `3000`, and HTTPS domain `hakapro.id`; staging and develop follow the table above. Apply runtime settings above to the app; disable any legacy Supabase build/runtime variables during the coordinated cutover. Keep the known-good deployment available until cutover is accepted.

[Resource inventory](docs/migrations/coolify-resources.md) records separate private PostgreSQL 17 databases: production `hakapro-postgres`, rehearsal `hakapro-rehearsal-postgres`. Each has its own persistent volume/password. Daily local backup schedules retain seven copies; offsite recovery and a restore drill remain required operational work. Never import into the existing Dashboard database.

Apply [versioned schema migrations](docs/migrations/postgres-schema.md) with the controlled private runner. Then follow the [private snapshot import and native-column reconciliation procedure](docs/migrations/source-data-import.md). Rehearsal import of the retained snapshot succeeded with zero mismatches; it does not replace the final frozen-source snapshot. Before production writes move, freeze all source writers, make recoverable source/target backups, import the fresh snapshot into an empty production target through reviewed target controls, and require zero mismatches plus auth/data/job smoke checks. Retained Google UUIDs/subjects survive; old sessions are invalidated. Bucket objects were empty in the rehearsal snapshot; any new objects require reviewed private transfer before cutover.

Rollback to the previous deployment is straightforward only before PostgreSQL accepts new writes. After new writes, review and reconcile those changes before changing routing back. Preserve the source project and recovery backups through stabilization.

The server's scheduled-task timezone is UTC. Configure `evaluate-alerts` at `45 9 * * 1-5`, timeout 300 seconds, after the PostgreSQL job smoke check. It calls the same application's internal endpoint and uses only the runtime job secret:

```sh
node -e 'fetch("http://127.0.0.1:3000/api/jobs/evaluate-alerts", { method: "POST", headers: { authorization: "Bearer " + process.env.ALERT_JOB_SECRET } }).then(async (response) => { console.log(await response.text()); if (!response.ok) process.exitCode = 1; }).catch(() => { console.error("ALERT_JOB_UNREACHABLE"); process.exitCode = 1; })'
```

`/api/health` is process liveness and never checks credentials/database. `/api/ready` returns 200 only when required auth/provider/email configuration, PostgreSQL connectivity and market health are ready; otherwise 503 with state codes. Google/SMTP checks confirm configured settings; real OAuth and email delivery still require operational smoke checks.
