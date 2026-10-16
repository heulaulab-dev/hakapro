# HAKAPRO Data Engine (`services/engine`)

Experimental internal collector and API for IDX data. Spec: [`docs/features/DATA-ENGINE.md`](../../docs/features/DATA-ENGINE.md). Phase E1 (HAKA-61) is the foundation only. No third-party source is registered yet; sources arrive in E2/E3 after discovery (E0).

It is a separate Bun + TypeScript service with no Next.js. It shares Zod contracts with the app through the `@/*` path (`src/server/schemas/idx-bei.ts`, `src/server/config/idx-calendar.ts`, `src/lib/freshness`).

## Layout

| Path | What |
| --- | --- |
| `src/main.ts` | Entry: `Bun.serve` on `PORT`, scheduler start, graceful SIGTERM |
| `src/engine.ts` | Wiring: DB, raw store, fetcher, registry, scheduler, HTTP handler |
| `src/http/` | Routes (`/health`, `/ready`, `/v1/meta/health`, `/v1/admin/*`, idx-bei `/v1/*` stubs) and the `{data, meta}` envelope |
| `src/fetch/` | Polite fetcher: per-host token bucket and concurrency, honest UA, ETag/Last-Modified, URL+sha256 dedupe, raw store (R2/S3 or local), block detection |
| `src/schedule/` | WIB cron, IDX session windows, disk/flag pause, single-flight scheduler, resumable backfill helper |
| `src/registry.ts` | Source/job registry (`defineSource`, intraday retention job) |
| `db/schema.ts`, `db/migrations/` | Engine Drizzle schema and generated SQL |
| `test/` | Fixture source (local HTTP server) and the Docker e2e test |

## Rules the code enforces (§2)

- One fixed user agent: `HAKAPRO-DataEngine/0.1 (+https://hakapro.heulaulab.xyz)`. No UA rotation, proxies, challenge solving or browser automation.
- Per-host limits: by default 1 request per 2 s and 2 in flight (`ENGINE_FETCH_*`). Intraday sources are forced to 1 in flight.
- A Cloudflare challenge, a 403 with `cf-ray`, a captcha, a login redirect or 401, or a **429** marks the source `BLOCKED`. The engine stores evidence (reason, status, allow-listed headers, markers), logs `SOURCE_BLOCKED`, and stops the source. It never retries on its own. Only `POST /v1/admin/sources/{id}/unblock` clears the block.
- Backoff (2 s, 4 s, 8 s; 4 attempts) applies only to 5xx responses and network errors.
- Every new document is stored raw (`<source>/<YYYY-MM-DD>/<sha256>.<ext>`) and indexed in `raw_documents`. A 304 or identical bytes stores nothing new.
- Every data row has `source`, `as_of` and `raw_ref`. Intraday data is served as `DELAYED` with its timestamp, never `LIVE`.

## Scheduler

- **Cron jobs** run on five-field cron in Asia/Jakarta. `tradingDaysOnly` skips weekends and IDX holidays (for EOD jobs).
- **Session jobs** (`{ kind: "session", everyMinutes }`, default 5 via `ENGINE_INTRADAY_INTERVAL_MINUTES`) run only inside IDX session windows, including the Friday times. They run at each session start, every N minutes, and at each session end. They never run during the lunch break or on non-trading days.
- Each job is **single-flight**. Manual runs skip the calendar check, but not the pause or a block.
- **Background jobs** (`background: true`: the backfill and retention) never start while another job runs. Once one does, `ctx.shouldYield()` turns true and they stop at the next batch boundary. `backfillJob()` runs from 2020-01-01 in small batches in a night window (`*/10 19-23,0-5 * * *` WIB). Its cursor is stored in `job_cursors`, so runs resume where they stopped. It stops at the day the daily EOD job owns.
- **Global pause:**
  - when disk use on `ENGINE_DATA_DIR` (statfs) goes above `ENGINE_DISK_STOP_PERCENT`, or cannot be measured;
  - while the flag file `${ENGINE_DATA_DIR}/PAUSE` exists. `POST /v1/admin/pause` and `/resume` set and clear it; use them during Coolify builds or maintenance.
- `intraday-retention` runs daily at 02:30 WIB and deletes `intraday_snapshots` older than `ENGINE_INTRADAY_RETENTION_DAYS`, in batches.

## HTTP

| Route | Auth | Notes |
| --- | --- | --- |
| `GET /health` | none | Liveness |
| `GET /ready` | none | 200 when the DB answers within 4 s and the disk is at or below the stop threshold, otherwise 503 |
| `GET /v1/meta/health` | API token | Per source: status, blocked/reason, last success/error, rows ingested. Also scheduler pause, disk %, jobs and raw store kind |
| `GET /v1/market`, `/v1/securities`, `/v1/news`, `/v1/announcements`, `/v1/stocks/{s}/fundamentals`, `/v1/stocks/{s}/actions`, `POST /v1/screener` | API token | E1 stubs: contract-valid empty data, `meta.freshness = UNAVAILABLE` |
| `GET /v1/stocks/{s}`, `/v1/stocks/{s}/profile`, `/v1/signals` | API token | `404 NO_DATA` until E2: these schemas have no empty form, and the engine never returns a fake quote |
| `POST /v1/admin/jobs/{id}/run`, `/v1/admin/pause`, `/v1/admin/resume`, `/v1/admin/sources/{id}/unblock` | `ENGINE_ADMIN_TOKEN` | Return 404 when the admin token is unset |

The API token is optional: when `ENGINE_API_TOKEN` is set, `Authorization: Bearer <token>` is required on `/v1/*`. The app's `IdxBeiSource` doesn't send a token yet, so leave it unset while the engine is reachable only on the private network. Otherwise, add token support to the app first.

## Environment variables

All are runtime-only. None is needed at build time.

| Variable | Default | |
| --- | --- | --- |
| `ENGINE_DATABASE_URL` | — (required) | Engine PostgreSQL (not the app DB) |
| `PORT` | `8080` | |
| `ENGINE_API_TOKEN` | unset | Bearer token for `/v1/*` |
| `ENGINE_ADMIN_TOKEN` | unset | Bearer token for `/v1/admin/*`; admin is disabled when unset |
| `ENGINE_DATA_DIR` | `.engine-data` (`/data` in the image) | Volume for the pause flag and the local raw-store fallback; the disk guard measures it |
| `ENGINE_DISK_STOP_PERCENT` | `85` | Crawling pauses above this |
| `ENGINE_FETCH_MIN_INTERVAL_MS` | `2000` | Default per-host spacing |
| `ENGINE_FETCH_CONCURRENCY` | `2` | Default per-host in-flight cap |
| `ENGINE_INTRADAY_INTERVAL_MINUTES` | `5` | Default session-job interval |
| `ENGINE_INTRADAY_RETENTION_DAYS` | `30` | `intraday_snapshots` retention |
| `ENGINE_SCHEDULER_ENABLED` | `true` | `false` serves the API only |
| `ENGINE_MIGRATE_ON_START` | `true` | Applies `db/migrations` at boot |
| `ENGINE_RAW_S3_ENDPOINT` | unset | R2: `https://6b331bf8590ae2dd7de440acdb2deeb5.r2.cloudflarestorage.com` |
| `ENGINE_RAW_S3_BUCKET` | unset | `hakapro-engine-raw` |
| `ENGINE_RAW_S3_ACCESS_KEY_ID` / `ENGINE_RAW_S3_SECRET_ACCESS_KEY` | unset | Bucket-scoped R2 token (Object Read & Write) |
| `ENGINE_RAW_S3_REGION` | `auto` | |

The four `ENGINE_RAW_S3_*` connection variables must be set together. Without them, raw documents go to `${ENGINE_DATA_DIR}/raw`. The S3 client is Bun's built-in `Bun.S3Client`.

## Running locally

```sh
docker run -d --name hakapro-engine-pg -e POSTGRES_USER=engine -e POSTGRES_PASSWORD=engine -e POSTGRES_DB=engine \
  -p 127.0.0.1:55432:5432 postgres:17-alpine
export ENGINE_DATABASE_URL=postgresql://engine:engine@127.0.0.1:55432/engine
bun run engine:db:migrate          # or let the engine migrate on start
ENGINE_ADMIN_TOKEN=dev-admin bun run engine:dev
curl localhost:8080/ready
curl localhost:8080/v1/meta/health
curl -X POST -H 'authorization: Bearer dev-admin' localhost:8080/v1/admin/jobs/intraday-retention/run
```

Scripts (repo root):

| Script | What it does |
| --- | --- |
| `engine:dev` / `engine:start` | Run the engine |
| `engine:typecheck` | Also run by `bun run typecheck` |
| `engine:db:generate` | `drizzle-kit generate` from `db/schema.ts` |
| `engine:db:migrate` | Apply the migrations |
| `engine:test:e2e` | Docker PostgreSQL + fixture source, end to end; not part of `bun run test` or CI |

Unit tests run with the root `bun run test`.

The image build uses `services/engine/package.json` and `bun.lock` only. Local development uses the root install. After changing a runtime dependency version at the root, mirror it there and run `bun install --lockfile-only` in `services/engine`.

## Coolify (one shared engine, §8.4)

- **Environment** `data-engine`, **application** `hakapro-engine` (separate from the web apps).
  - Build pack: Dockerfile.
  - Base directory `/`, Dockerfile location `/services/engine/Dockerfile`.
  - Port 8080.
  - Health check path `/health`; the image also has its own `HEALTHCHECK`.
- **Database:** a private PostgreSQL 17 resource `hakapro-engine-postgres` in the same environment. Set `ENGINE_DATABASE_URL` to its internal URL.
- **Resources:** memory limit 512 MB and 0.5 CPU (an idle engine uses about 30 MB).
- **Storage:** a persistent volume mounted at `/data`.
- **Env vars:** runtime only, never "build variable":
  - `ENGINE_DATABASE_URL`
  - `ENGINE_ADMIN_TOKEN`
  - optionally `ENGINE_API_TOKEN`
  - the R2 variables, once the owner issues the bucket-scoped token
- **Consumers:** develop, staging and production set `MARKET_API_URL` to the engine's private-network URL (for example `http://hakapro-engine:8080`). Only point an environment at the engine when E2 serves real data. The stubs return empty or `UNAVAILABLE` data.
- **Builds:** pause crawling around deployments with `POST /v1/admin/pause`, then `/resume`. Coolify concurrent builds are already 1.
- **Startup:** the engine waits up to 60 s for PostgreSQL, then exits non-zero, and Coolify's restart policy brings it back. If the DB hostname does not resolve at boot, Bun caches the failed lookup for the life of the process, so a restart is the recovery path.
