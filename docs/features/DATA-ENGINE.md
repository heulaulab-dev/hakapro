# HAKAPRO Data Engine

Status: **experimental, internal use** (decided 2026-10-16). Plane module "Data Engine".

## 1. Why

arjum gives per-stock data under a 1000 requests/day quota. It has no whole-market end-of-day history, no ≥1% ownership, no index or breadth data, and no news or disclosures. Several features are blocked on that:

- the custom strategy scans for the whole market (HAKA-17);
- movers and breadth from HAKAPRO's own data, plus news and calendar (Market Intelligence);
- monthly ownership changes and free float (HAKA-33/34).

The Data Engine is HAKAPRO's own collector and server for that data.

## 2. Collection rules (replace the 2026-10-03 "no crawling" rule for the engine)

The product is internal for now, and the owner loosened the rules for this experimental phase.

**Allowed:**
- crawling public sources, including whole-market daily runs and intraday frequency;
- using sources without written permission, for internal use only;
- treating `robots.txt` as guidance (prefer to honour it);
- universe-wide arjum calls within its daily quota.

**Never:**
- solving Cloudflare/anti-bot challenges;
- rotating IPs or proxies to evade blocks, or faking browser fingerprints;
- scraping login or paywalled pages;
- tight retry loops after a 429 or a block.

A blocked source stops and raises a `SOURCE_BLOCKED` alert for the owner.

**Always:**
- send an honest user agent: `HAKAPRO-DataEngine/0.1 (+https://hakapro.heulaulab.xyz)`;
- apply a rate limit per host;
- cache by URL and ETag, so each document is fetched once;
- keep a raw copy, so data can be re-parsed without re-crawling;
- give every stored row a `source` and an `asOf`.

**Before HAKAPRO goes public or paid:** review data rights. IDX price redistribution needs a licence, KSEI ≥1% data needs written permission for commercial reuse, and news must be stored as headline + link only.

## 3. Architecture

```
sources ─► fetchers (policy: rate limit, UA, cache, block detection)
            │ raw documents (+ url, fetchedAt, sha256, status)
            ▼
         raw store (R2 bucket; local volume only as a fallback)
            │ parsers (Zod-validated, one per source + format)
            ▼
         engine PostgreSQL (normalized tables, every row: source, asOf, rawRef)
            │ derivations (breadth, movers, foreign flow, strategy scans, ownership changes)
            ▼
         HTTP API /v1/*  ─►  HAKAPRO BFF (MARKET_API_URL, existing idx-bei lane)
```

**Code:** `services/engine/` in this repo. It runs on Bun with TypeScript and shares Zod contracts with the app (`src/server/schemas/idx-bei.ts`, `src/lib/strategies/contract.ts`, `src/lib/ownership/*`). It has its own Dockerfile and is a separate Coolify app, so a crash or memory spike can't take the web app down.

**API compatibility:** the engine serves the contract HAKAPRO's `IdxBeiSource` already consumes:
- `/v1/market` (indices, breadth, movers)
- `/v1/stocks/{s}` (quote + daily candles)
- `/v1/stocks/{s}/fundamentals`, `/actions`, `/profile`
- `/v1/securities`
- `/v1/signals`
- `POST /v1/screener`
- `/v1/news`
- `/v1/announcements`

Responses use the `{data, meta}` envelope. The app's composite source already uses arjum first and fills gaps from idx-bei when `MARKET_API_URL` is set, so connecting the engine is a configuration change. New capabilities, such as strategy scans and ownership, get new `/v1/*` routes plus app adapters (for example `HAKAPRO_EOD_ENGINE` in the HAKA-18 strategy contract).

**Storage:**
- A separate private PostgreSQL 17 (`hakapro-engine-postgres`, one shared engine; see §8) keeps engine volume out of the app database.
- Drizzle migrations live in `services/engine`.
- Raw documents go to an R2 bucket (`hakapro-engine-raw`; needs its own bucket-scoped token) with a retention policy.

**Scheduling:** an in-process scheduler driven by the IDX calendar (`src/server/config/idx-calendar.ts`):

| Job | Time |
| --- | --- |
| EOD runs | after the close, about 16:30 WIB; retry until the session's data is present, otherwise mark STALE |
| Disclosures and news | every 15–30 minutes during the day |
| Reference data | daily |
| Ownership | monthly |

Builds and crawls never overlap.

**Freshness:** derived from `asOf` with the existing session clock; never LIVE. Intraday data is DELAYED with its timestamp.

## 4. Running on the current server (owner's choice)

The Coolify server is shared and tight: disk was 64–85%, and builds have killed other containers. Safeguards:

- Coolify concurrent builds set to **1** (done 2026-10-16) and disk checks **hourly** (done).
- Engine container memory/CPU limits (start at 512 MB / 0.5 CPU) and fetch concurrency of 2 per host.
- Crawls are scheduled outside market hours where possible and are paused while a deployment is building.
- Raw documents go to R2, not local disk. Postgres stores normalized rows only.
- Crawling stops automatically above 85% disk (from the engine's own volume and `/api/ready` check).
- `/v1/meta/health` reports per-source last success, last error, rows ingested, and block status.

## 5. Sources by priority

Endpoints and formats are confirmed in a discovery task (one polite request per candidate) before any fetcher is written. "Blocked" means the fetcher stops; it is never bypassed.

| # | Data | Candidate source | Notes |
| --- | --- | --- | --- |
| 1 | Universe (listed companies, board, notation, listing date) | IDX public company/stock list | Needed by everything; also the HAKA-17 eligibility gate (board/notation) |
| 2 | **EOD prices, all stocks** (OHLCV, value, frequency, foreign buy/sell) | IDX daily stock summary | Unblocks whole-market strategy scans, movers, breadth, foreign flow. Backfill history gradually. Check whether prices are split-adjusted |
| 3 | Indices (IHSG, sector indices) | IDX index summary | `/v1/market` indices |
| 4 | Disclosures / announcements | IDX keterbukaan informasi | Title, symbol, date, document link; documents fetched lazily |
| 5 | Financial statements | IDX financial reports (XBRL/PDF) | Fundamentals for `/v1/stocks/{s}/fundamentals` and screener ratios |
| 6 | Corporate actions | IDX/KSEI calendars | Dividends, splits, rights; also needed for price adjustment |
| 7 | News | RSS feeds from Indonesian business outlets | Headline, link, time, source only |
| 8 | Macro | BI (policy rate, FX), BPS API (needs a free key) | Market-info panels |
| 9 | Ownership ≥1% | Monthly KSEI lists via IDX announcement PDFs | Feeds the HAKA-33 engine; parse PDFs; schema gap noted in CONNECTION-NETWORK.md |
| — | Per-stock extras | arjum (existing) | Stays the primary source for broker summary, insiders and analysis; engine doesn't duplicate it |

## 6. Data model (first cut)

- `sources`: id, host, policy (rate limit, schedule), status, last success/error, blocked_at.
- `raw_documents`: id, source, url, fetched_at, http_status, sha256, r2_key, content_type, parse_status.
- `securities`: symbol, name, board, notation, sector, listing_date, shares_outstanding, active.
- `daily_prices`: symbol, date, open/high/low/close, volume, value, frequency, foreign buy/sell, source, raw_ref. Primary key (symbol, date).
- `index_daily`: code, date, OHLC/close, change.
- `announcements`: id, symbol, published_at, title, category, document_url, raw_ref.
- `news_items`: id, published_at, title, url, outlet, symbols[].
- `corporate_actions`: symbol, type, ex/record/payment dates, ratio/amount, source.
- `financials`: symbol, period, statement, metric, value, unit, source.
- `ownership_snapshots`: per the HAKA-33 types, with a parent snapshot-set table.

Every table has `source` and `as_of`; derived tables also record the derivation version.

## 7. Phases (Plane module "Data Engine")

| Phase | Work |
| --- | --- |
| E0. Discovery | Confirm endpoints, formats, update times and block behaviour for sources 1–9 with single requests. Record findings here |
| E1. Foundation | `services/engine` (Bun, Dockerfile, health), engine DB + Drizzle, fetcher framework (policy, cache, raw store, block detection), scheduler, `/v1/meta/health`. Coolify environment `data-engine` with app + DB |
| E2. Universe + EOD prices | Sources 1–2, daily run + backfill since 2020-01-01, `/v1/securities`, `/v1/stocks/{s}`, `/v1/market` movers/breadth. Point develop's `MARKET_API_URL` at it first, then staging and production |
| E3. Market info | Indices, announcements, news, corporate actions, macro → `/v1/market`, `/v1/news`, `/v1/announcements`, `/v1/stocks/{s}/actions` |
| E4. Strategy scans | `HAKAPRO_EOD_ENGINE` running the approved HAKA-17 rules over the whole universe, exposed via the HAKA-18 contract |
| E5. Fundamentals + screener | Financial statements → fundamentals and `POST /v1/screener` |
| E6. Ownership | Monthly ≥1% lists → HAKA-33 change engine and HAKA-34 estimate (draft until approved) |

## 8. Decisions (owner, 2026-10-16)

1. **Raw store:** a new R2 bucket, `hakapro-engine-raw` (created 2026-10-16), with its own bucket-scoped token (Object Read & Write, owner creates it). It is not shared with `heulaulab-db-backups`.
2. **EOD history:** backfill from **2020-01-01**, matching arjum's daily history. The backfill runs gradually at night and never competes with the daily run.
3. **Intraday:** **EOD only** for now. Delayed intraday waits until after E3, or for Running Trade (HAKA-14/15).
4. **Deployment:** **one shared engine** during the experiment. It runs in its own Coolify environment `data-engine` (app `hakapro-engine`, PostgreSQL `hakapro-engine-postgres`) and serves develop, staging and production over the private network (`MARKET_API_URL`). Per-environment engines can come later if needed.
