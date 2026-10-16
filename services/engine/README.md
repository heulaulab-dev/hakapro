# HAKAPRO Data Engine (`services/engine`)

Experimental internal collector and API for IDX data. Spec: [`docs/features/DATA-ENGINE.md`](../../docs/features/DATA-ENGINE.md).

- E1 (HAKA-61): the foundation (fetcher, raw store, scheduler, health).
- E2 (HAKA-62): universe, EOD prices, the 2020-01-01 backfill, index EOD and arjum foreign flow, served on the idx-bei `/v1` contract.
- E2b (HAKA-67): session-window intraday snapshots, served as `DELAYED`.
- E3 (HAKA-63): market info: news RSS headlines, BI-Rate and JISDOR, the market-wide corporate-action calendar; announcements stay unavailable (IDX blocked).

It is a separate Bun + TypeScript service with no Next.js. It shares code with the app through the `@/*` path: the idx-bei and arjum Zod contracts (`src/server/schemas/`), the arjum URL builder, the IDX calendar, the freshness clock, the arjum page limits and the movers ranking.

## Layout

| Path | What |
| --- | --- |
| `src/main.ts` | Entry: `Bun.serve` on `PORT`, scheduler start, graceful SIGTERM |
| `src/engine.ts` | Wiring: DB, raw store, fetcher, the production registry (sources + jobs), scheduler, HTTP handler |
| `src/sources/` | One module per source: URL/body builders and parsers (TradingView, Yahoo, Pasardana, arjum, the news feeds, Bank Indonesia), a small RSS/Atom reader, source policies, IDX session dates |
| `src/jobs/` | Collection jobs: `universe`, `indices-eod`, `eod-daily`, `eod-backfill`, `foreign-flow`, `intraday`, `news`, `macro-jisdor`, `macro-bi-rate` |
| `src/db/ingest.ts`, `src/db/market-info.ts`, `src/db/market-store.ts` | Idempotent upserts with source precedence (prices) and dedupe (news); the read store behind `/v1` |
| `src/serve/` | Builds `/v1` payloads (quote, candles, breadth, movers, indices, foreign-flow signals, actions, news, macro, the actions calendar) from stored rows |
| `src/http/` | Routes (`/health`, `/ready`, `/v1/meta/health`, `/v1/admin/*`, idx-bei `/v1/*`) and the `{data, meta}` envelope |
| `src/fetch/` | Polite fetcher: per-host token bucket and concurrency, honest UA, ETag/Last-Modified, URL+sha256 dedupe, raw store (R2/S3 or local), block detection |
| `src/schedule/` | WIB cron, IDX session windows, disk/flag pause, single-flight scheduler, resumable backfill helpers (per day and per item) |
| `src/registry.ts` | Source/job registry (`defineSource`, intraday retention job) |
| `db/schema.ts`, `db/migrations/` | Engine Drizzle schema and generated SQL |
| `test/` | Recorded source fixtures, the local fixture world, and the Docker e2e suites |

## Rules the code enforces (§2)

- One fixed user agent: `HAKAPRO-DataEngine/0.1 (+https://hakapro.heulaulab.xyz)`. No UA rotation, proxies, challenge solving or browser automation.
- Per-host limits: by default 1 request per 2 s and 2 in flight (`ENGINE_FETCH_*`). Intraday sources are forced to 1 in flight.
- A Cloudflare challenge, any **403** (`CDN_FORBIDDEN` with `cf-ray` or CloudFront headers, otherwise `FORBIDDEN`), a captcha, a login redirect or 401, or a **429** marks the source `BLOCKED`. The engine stores evidence (reason, status, allow-listed headers, markers), logs `SOURCE_BLOCKED`, and stops the source. It never retries on its own. Only `POST /v1/admin/sources/{id}/unblock` clears the block.
- Extra request headers are only for a documented credential (arjum `x-api-key`) or a content type. The fetcher refuses user-agent, cookie, conditional and forwarding headers, never stores the credential, and never follows a redirect with it (or with a POST).
- Backoff (2 s, 4 s, 8 s; 4 attempts) applies only to 5xx responses and network errors.
- Every new document is stored raw (`<source>/<YYYY-MM-DD>/<sha256>.<ext>`) and indexed in `raw_documents`. A 304 or identical bytes stores nothing new. A POST (TradingView's scanner) is indexed as its URL plus `#post-<body hash>`.
- Every data row has `source`, `as_of` and `raw_ref`. On `daily_prices`, those describe the OHLCV; value/frequency (`value_source`, `value_raw_ref`) and foreign flow (`foreign_source`, `foreign_as_of`, `foreign_raw_ref`) keep their own provenance. Intraday data is served as `DELAYED` with its timestamp, never `LIVE`.

## Sources and jobs (E2, E2b, E3)

The four price sources are unofficial (§8.6): fine for the internal experiment, never for a public or paid HAKAPRO. The news feeds are public RSS (headline + link only, §2); Bank Indonesia publishes official statistics.

| Source id | Host | Policy | Used for |
| --- | --- | --- | --- |
| `tradingview-scanner` | `scanner.tradingview.com` | 1 request / 2 s, 1 in flight | Universe, session values, index EOD, intraday (10 min delayed) |
| `yahoo-chart` | `query1.finance.yahoo.com` | 1 request / 3 s, 1 in flight | Daily OHLCV (`range=5d`), history from 2020-01-01, splits/dividends, IHSG `^JKSE` |
| `pasardana` | `pasardana.id` | 1 request / 3 s, 1 in flight | Sectors (IDX-IC), capitalisation, shares, free float, previous-session value/frequency |
| `arjum` | from `ENGINE_ARJUM_BASE_URL` | 1 request / 2 s, 1 in flight | Foreign buy/sell (`/api/history/{code}?limit=20`); registered only when configured |
| `news-cnbcindonesia` | `www.cnbcindonesia.com` | 1 request / 5 s, 1 in flight | `/market/rss` |
| `news-detik` | `finance.detik.com` | 1 request / 5 s, 1 in flight | `/rss` (general finance) |
| `news-antara` | `www.antaranews.com` | 1 request / 5 s, 1 in flight | `/rss/ekonomi-bursa.xml` |
| `news-investortrust` | `investortrust.id` | 1 request / 5 s, 1 in flight | `/rss/market.rss` and `/rss/macro.rss` (one source, two feeds) |
| `bank-indonesia` | `www.bi.go.id` | 1 request / 5 s, 1 in flight | BI-Rate (`/id/statistik/indikator/bi-rate.aspx`) and JISDOR (`/id/statistik/informasi-kurs/jisdor/default.aspx`) tables |

Schedules (WIB; "trading days" skips weekends and IDX holidays):

| Job | When | What |
| --- | --- | --- |
| `intraday` | Every `ENGINE_INTRADAY_INTERVAL_MINUTES` (default 5, minimum 1) inside sessions | One TradingView `indonesia/scan` (whole market) and one `global/scan` (IHSG, LQ45, IDX30, IDX-IC sectors) → `intraday_snapshots`, `index_intraday`. Stamped with the data time (fetch time minus the stated 600 s delay). A byte-identical poll adds nothing |
| `universe` | 16:35, trading days | TradingView scan + paginated Pasardana pass → `securities` (board/notation unknown = null). Fallback session rows in `daily_prices`. Either source carries the run when the other is `BLOCKED`; symbols are deactivated only when both lists are complete |
| `indices-eod` | 16:35, trading days | TradingView index scan → `index_daily` (primary) once the session is final |
| `eod-daily` | 16:45, 18:45, 20:45, trading days | Yahoo `range=5d` per active symbol, most liquid first, plus `^JKSE` (~900 calls ≈ 45 min at 3 s). Later runs fetch only symbols still missing the session's Yahoo row. The 20:45 run (or any run after the session day) is final: `eod_sessions` becomes `COMPLETE` or `STALE` |
| `foreign-flow` | 19:00, 21:00, trading days | arjum, most liquid first by the session's value. Stops at `ENGINE_ARJUM_DAILY_BUDGET` calls per WIB day (counted in `job_cursors` across runs), when `x-ratelimit-remaining` drops below `ENGINE_ARJUM_RESERVE`, or on a 429/401/403 (source `BLOCKED`). Unreached stocks keep `foreignBuy/foreignSell` null |
| `eod-backfill` | Every 10 min, 19:00–05:59, background | One Yahoo call per symbol (and `^JKSE`) from 2020-01-01 up to the session the daily job owns, 10 per run. The cursor lists finished symbols, so new listings join automatically. Yields to every other job |
| `intraday-retention` | 02:30, background | Prunes `intraday_snapshots` and `index_intraday` past `ENGINE_INTRADAY_RETENTION_DAYS` |
| `news` | Every `ENGINE_NEWS_INTERVAL_MINUTES` (default 15, minimum 5) from 06:00 to 22:00, every day | One conditional GET per feed (ETag / Last-Modified; a 304 or identical bytes adds nothing) → `news_items`. Each outlet is its own source: a block stops that outlet only. Items older than the retention window are not stored |
| `news-retention` | 02:45, background | Prunes `news_items` published before `ENGINE_NEWS_RETENTION_DAYS` (default 180) |
| `macro-jisdor` | 17:00 daily | BI JISDOR table, first page (latest 10 business days) → `macro_observations` |
| `macro-bi-rate` | 17:05 daily | BI-Rate table, first page (latest 10 decisions, with the press-release link) → `macro_observations` |

Precedence: Yahoo is the primary OHLC source for stocks and overwrites TradingView/Pasardana/arjum fallback rows, but never their value/frequency. Pasardana's value/frequency replace TradingView's value. TradingView is primary for `index_daily`; Yahoo `^JKSE` only fills gaps. A fallback source refreshes only rows it wrote itself.

News items (`news_items`) keep: the headline, the canonical link (lower-case host, no fragment or `utm_*`-style tracking parameters), `published_at` (RSS/Atom dates with their zone; a date without a zone is read as WIB; missing, unparseable or more than an hour in the future → the fetch time with `published_at_estimated = true`), the outlet, a summary only when the feed itself has a description (HTML stripped, at most 280 characters; `content:encoded` is never read) and matched symbols. The engine never fetches an article page. Dedupe: the canonical URL is unique, and the same normalized title within 3 days (any outlet) is one story. Symbols: `$BBCA` always counts when the symbol is in `securities`; a bare upper-case four-letter word counts only when it is in `securities`, not on `SYMBOL_STOPLIST` (common words, brands and abbreviations such as `BANK`, `DATA`, `IHSG`, `MSCI`) and the text is not written in capitals.

Macro rows (`macro_observations`) are `(series, date)`: `BI_RATE` in percent and `JISDOR` in IDR per USD. Only the first table page is read: older rows need an ASP.NET `__VIEWSTATE` postback, which the engine does not do. A table that changes shape fails the parse (raw copy `FAILED`) instead of storing guesses. BPS is deferred until the owner registers a key (§8.7).

Fallbacks when a source is `BLOCKED`: universe from Pasardana (or TradingView); session rows from TradingView/Pasardana (and arjum) when Yahoo is blocked; IHSG from Yahoo when TradingView is blocked. Intraday has no fallback: `/v1` then serves the latest EOD.

## Scheduler

- **Cron jobs** run on five-field cron in Asia/Jakarta. `tradingDaysOnly` skips weekends and IDX holidays (for EOD jobs).
- **Session jobs** (`{ kind: "session", everyMinutes }`, default 5 via `ENGINE_INTRADAY_INTERVAL_MINUTES`) run only inside IDX session windows, including the Friday times. They run at each session start, every N minutes, and at each session end. They never run during the lunch break or on non-trading days.
- Each job is **single-flight**. Manual runs skip the calendar check, but not the pause or a block.
- **Background jobs** (`background: true`: the backfill and retention) never start while another job runs. Once one does, `ctx.shouldYield()` turns true and they stop at the next batch boundary. `backfillJob()` (per day) and `itemBackfillJob()` (per symbol, used by `eod-backfill`) run from 2020-01-01 in small batches in a night window (`*/10 19-23,0-5 * * *` WIB). Their cursor is stored in `job_cursors`, so runs resume where they stopped. They stop at the day the daily EOD job owns.
- **Global pause:**
  - when disk use on `ENGINE_DATA_DIR` (statfs) goes above `ENGINE_DISK_STOP_PERCENT`, or cannot be measured;
  - while the flag file `${ENGINE_DATA_DIR}/PAUSE` exists. `POST /v1/admin/pause` and `/resume` set and clear it; use them during Coolify builds or maintenance.
- `intraday-retention` runs daily at 02:30 WIB and deletes `intraday_snapshots` and `index_intraday` rows older than `ENGINE_INTRADAY_RETENTION_DAYS`, in batches.

## HTTP

| Route | Auth | Notes |
| --- | --- | --- |
| `GET /health` | none | Liveness |
| `GET /ready` | none | 200 when the DB answers within 4 s and the disk is at or below the stop threshold, otherwise 503 |
| `GET /v1/meta/health` | API token | Per source: status, blocked/reason, last success/error, rows ingested. Also scheduler pause, disk %, jobs, raw store kind, the last EOD sessions (`COMPLETE`/`PARTIAL`/`STALE`, expected/present) and `unavailable`: the routes served empty on purpose and why (`SOURCE_BLOCKED` announcements and profile, `NOT_BUILT` fundamentals and screener) |
| `GET /v1/securities?q=` | API token | Active securities by symbol prefix or name (all when `q` is empty) |
| `GET /v1/stocks/{s}?limit=` | API token | Quote from the newest daily row (`EOD`/`STALE`), or from an intraday snapshot of a newer session (`DELAYED`, WIB timestamp). Daily candles, oldest first, up to `limit` (default 500, max 5000). `404 NO_DATA` without data |
| `GET /v1/market` | API token | Indices (intraday when newer), breadth (advancers/decliners/unchanged, value, volume, frequency) and movers (top 50 gainers, losers and most active, same liquidity rule as the app) from the latest session or intraday snapshot |
| `GET /v1/signals` | API token | Foreign-flow radar from arjum data: per stock, the run of same-direction net foreign sessions ending on the newest session, its total, % of free float and average value. `404 NO_DATA` until foreign data exists |
| `GET /v1/stocks/{s}/actions` | API token | Splits and cash dividends (ex-dates) from Yahoo events |
| `GET /v1/actions?from=&to=` | API token | Market-wide calendar by ex-date, oldest first (`actionsCalendarSchema`): symbol, date, type, description, amount, ratio. Default window: 30 days back to 60 days ahead (WIB); at most 366 days. Yahoo reports actions only after the ex-date, so upcoming dates are usually empty. `400` on bad dates |
| `GET /v1/news?page=&page_size=&symbol=` | API token | Headlines newest first (`newsItemSchema`): `date` (WIB ISO), `title`, `summary`, `url`, plus `outlet`, `symbols`, `dateEstimated`. `page_size` 1–100 (default 20). `meta.freshness` is `DELAYED` while the newest headline is under a day old, then `STALE` |
| `GET /v1/macro` | API token | BI-Rate and JISDOR (`macroSchema`): latest value and date, the previous one, the press-release link (BI-Rate), and up to 10 observations newest first. `meta.dataAsOf` is the newest date |
| `GET /v1/announcements` | API token | Always the empty `UNAVAILABLE` form: IDX disclosures are only on `www.idx.co.id`, which blocks the engine (Cloudflare 403, §5.4). `/v1/meta/health` lists it under `unavailable` with the reason |
| `GET /v1/stocks/{s}/fundamentals`, `POST /v1/screener` | API token | Stubs until E5: contract-valid empty data, `meta.freshness = UNAVAILABLE` |
| `GET /v1/stocks/{s}/profile` | API token | `404 NO_DATA` (no source) |
| `POST /v1/admin/jobs/{id}/run`, `/v1/admin/pause`, `/v1/admin/resume`, `/v1/admin/sources/{id}/unblock` | `ENGINE_ADMIN_TOKEN` | Return 404 when the admin token is unset |

Every `/v1` response is validated with the shared idx-bei Zod schemas before it leaves. `meta.dataAsOf` is the session date, or the WIB timestamp of an intraday snapshot; routes with no stored data keep the E1 empty forms. The app re-derives freshness from `dataAsOf` with the same IDX clock, and the contract test (`tests/unit/engine-idx-bei-contract.test.ts`) parses both the stubs and real responses through `IdxBeiSource`.

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
| `ENGINE_INTRADAY_INTERVAL_MINUTES` | `5` | Intraday poll interval inside sessions; minimum 1 (never faster than 60 s) |
| `ENGINE_INTRADAY_RETENTION_DAYS` | `30` | `intraday_snapshots` / `index_intraday` retention |
| `ENGINE_NEWS_INTERVAL_MINUTES` | `15` | News poll interval inside 06:00–22:00 WIB; minimum 5 |
| `ENGINE_NEWS_RETENTION_DAYS` | `180` | `news_items` retention (by publication time) |
| `ENGINE_ARJUM_BASE_URL` / `ENGINE_ARJUM_API_KEY` | unset | arjum base URL and key (same provider and key as the app's `HEULATRADE_MARKET_API_BASE_URL` / `_KEY`). Set together; without them `foreign-flow` is not registered and foreign buy/sell stay null |
| `ENGINE_ARJUM_DAILY_BUDGET` | `600` | Max arjum calls per WIB day for foreign flow (of the shared 1000/day quota) |
| `ENGINE_ARJUM_RESERVE` | `400` | Stop while arjum's `x-ratelimit-remaining` is below this (the app environments' share) |
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

Running `universe`, `eod-daily`, `intraday`, `news` or the `macro-*` jobs locally calls the real sources (honest UA, rate-limited). Keep `ENGINE_SCHEDULER_ENABLED=false` unless you mean to crawl, and trigger single jobs by hand.

Scripts (repo root):

| Script | What it does |
| --- | --- |
| `engine:dev` / `engine:start` | Run the engine |
| `engine:typecheck` | Also run by `bun run typecheck` |
| `engine:db:generate` | `drizzle-kit generate` from `db/schema.ts` |
| `engine:db:migrate` | Apply the migrations |
| `engine:test:e2e` | Docker PostgreSQL + the fixture world: every job, block/fallback paths, news (conditional GET, dedupe, per-outlet blocks, retention), macro, and universe → EOD → foreign → intraday → `/v1`; not part of `bun run test` or CI |

Unit tests run with the root `bun run test` (parsers, fetcher, scheduler, `/v1` derivations and routes).

### Fixtures

`test/fixtures/` holds trimmed real responses for the parsers, recorded on 2026-10-16 between 11:29 and 11:40 WIB with 8 requests in total (honest UA, at least 2 s apart per host, no block seen): TradingView `indonesia/scan` (5 rows) and `global/scan` (two calls: the confirmed index list), Pasardana `GetAll` (3 rows, plus one call that confirmed 1-based paging), and Yahoo chart for `BBCA.JK` (5d, and 2021 events trimmed to 5 bars) and `^JKSE` (5d). The E3 fixtures were recorded on 2026-10-16 between 14:27 and 14:28 WIB with 7 requests (one per URL, honest UA, no retries, at least 6 s apart and never two in a row to one host, no block seen): the five news feeds trimmed to 3 items each (`news-*.xml`) and the BI-Rate and JISDOR pages trimmed to the table with 3 rows (`bi-rate.html`, `bi-jisdor.html`; the BI-Rate one keeps its commented-out `BI-7 Day` column). `arjum-history-BBCA.fake.json` is invented data in the shape of `fixtures/arjum`; arjum was not called. `test/source-fixtures.ts` serves them at the real paths and refuses every other URL, so no test touches the network.

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
  - `ENGINE_ARJUM_BASE_URL` and `ENGINE_ARJUM_API_KEY` for foreign flow (optionally `ENGINE_ARJUM_DAILY_BUDGET`, `ENGINE_ARJUM_RESERVE`)
- **Consumers:** develop, staging and production set `MARKET_API_URL` to the engine's private-network URL (for example `http://hakapro-engine:8080`). Point develop at it first, once the first universe and EOD runs have filled the tables (`/v1/meta/health` shows the sources `OK` and the session `COMPLETE` or `PARTIAL`); routes without data still answer with empty `UNAVAILABLE` envelopes or `404 NO_DATA`.
- **Builds:** pause crawling around deployments with `POST /v1/admin/pause`, then `/resume`. Coolify concurrent builds are already 1.
- **Startup:** the engine waits up to 60 s for PostgreSQL, then exits non-zero, and Coolify's restart policy brings it back. If the DB hostname does not resolve at boot, Bun caches the failed lookup for the life of the process, so a restart is the recovery path.
