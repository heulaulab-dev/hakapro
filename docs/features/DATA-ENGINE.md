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

A blocked source stops and raises a `SOURCE_BLOCKED` alert for the owner. A rate limit (429) is not a refusal: the
source rests on a cooldown ladder (2 h, 6 h, 24 h, 72 h for rate limits within a week of each other, or the server's
`Retry-After` if later), then its next scheduled run may fetch again. A fifth rate limit in a row, and every other
block (403, challenge, captcha, login), stays blocked until an admin unblock. (Added 2026-10-21: one 429 on
2026-10-18 had stopped Yahoo for good; the same requests worked from another network, so it was a rate limit, not a
ban.)

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

**Freshness:** derived from `asOf` with the existing session clock; never LIVE. Intraday snapshots are DELAYED with their timestamp (§8.3).

## 4. Running on the current server (owner's choice)

The Coolify server is shared and tight: disk was 64–85%, and builds have killed other containers. Safeguards:

- Coolify concurrent builds set to **1** (done 2026-10-16) and disk checks **hourly** (done).
- Engine container memory/CPU limits (start at 512 MB / 0.5 CPU) and fetch concurrency of 2 per host.
- Crawls are scheduled outside market hours where possible and are paused while a deployment is building.
- Raw documents go to R2, not local disk. Postgres stores normalized rows only.
- Crawling stops automatically above 85% disk (from the engine's own volume and `/api/ready` check).
- `/v1/meta/health` reports per-source last success, last error, rows ingested, and block status.

## 5. Sources: discovery results (2026-10-16)

Phase E0 (HAKA-60). Each candidate URL got one request with the engine's user agent
(`HAKAPRO-DataEngine/0.1 (+https://hakapro.heulaulab.xyz)`), at least 2 s apart per host. There were **31 requests in
total**. No challenge was solved, no user agent was switched, no cookies were used, and no bulk data was downloaded or
committed. Tested 10:40–10:55 WIB on Friday 2026-10-16, a live session with a market-wide sell-off. Sizes are measured
from single responses and scaled to about 900 stocks.

**Statuses:**
- **OK:** reachable, with the needed fields confirmed.
- **PARTIAL:** reachable, but some fields are missing or the source is unofficial.
- **BLOCKED:** the fetcher must stop.
- **NOT FOUND:** no public endpoint was confirmed.

Planned sources (from the spec, before discovery):

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

### 5.0 Headline

- **idx.co.id is BLOCKED for the engine.** The first request (`GET https://www.idx.co.id/id`) got **HTTP 403** from
  `server: cloudflare`, `cf-ray: a4b40c040d19d4f1-SIN`, on the page "Attention Required! | Cloudflare / Sorry, you have
  been blocked". This is a firewall block, not a JS challenge. Per §2 the host was not touched again, so none of the
  `/primary/*` or `/umbraco/*` JSON endpoints could be found or confirmed. Every source the spec planned to take from
  IDX (1–6 and 9) therefore needs an alternative or an IDX-side arrangement.
- **KSEI is unusable as well:**
  - `www.ksei.co.id/` answers 200 with a **4-byte body `Test`**. The headers include `vary: User-Agent` and
    `x-powered-by: Exabytes`, so the content is chosen by user agent and the honest user agent gets a placeholder.
  - The old documented bulk path `/Download/BalanceposEfek<yyyymmdd>.zip` returns 404.
  - `web.ksei.co.id` **times out on TCP connect** (10 s, then 25 s), which looks like IP or geo filtering.
  - No user-agent change was tried. This is treated as BLOCKED.
- **Open sources that work:**
  - Yahoo Finance chart JSON for per-symbol EOD, intraday, splits and dividends, and IHSG.
  - TradingView's public scanner for whole-market and index snapshots, delayed 10 min.
  - Pasardana's public JSON for the universe plus the EOD snapshot with ratios.
  - Bank Indonesia HTML tables.
  - The BPS API, which needs a key.
  - Four news RSS feeds.
- **None of the open sources gives foreign buy/sell.**

### 5.1 Universe (source 1)

| Status | Endpoint | Format | Update | History | Size/run | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| BLOCKED | IDX company/stock list (www.idx.co.id) | — | — | — | — | Cloudflare 403 (see 5.0) |
| **PARTIAL** | `GET https://pasardana.id/api/StockSearchResult/GetAll?pageBegin=1&pageLength=<n>&sortField=Code&sortOrder=ASC` | JSON array | Daily after EOD (`LastDate` = previous session at 10:50 WIB) | Snapshot only | ~1 KB/row, about 1 MB for the whole universe | Fields: `Code, Name, SectorName, SubSectorName, NewSectorName, NewSubSectorName, NewIndustryName, Capitalization, FreeFloatPct, LastDate, LastUpdate`. **No board, notation or listing date**, so the HAKA-17 eligibility gate is still uncovered. Third-party aggregator; terms not reviewed |
| PARTIAL | TradingView scanner (see 5.2) | JSON | Live, delayed | Snapshot | — | `totalCount: 887` IDX symbols. Can list symbols plus sector, but has no board or notation |

### 5.2 EOD prices, all stocks (source 2)

| Status | Endpoint | Format | Update | History | Size/run | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| BLOCKED | IDX stock summary (www.idx.co.id) | — | — | — | — | Cloudflare 403. This was the only planned source of **foreign buy/sell** |
| **OK (unofficial)** | `GET https://query1.finance.yahoo.com/v8/finance/chart/<SYM>.JK?range=<5d\|1y\|max>&interval=1d&events=div%2Csplit` | JSON (`chart.result[0]`) | Intraday-updating. The final bar settles after the close (`currentTradingPeriod.regular.end` = 16:15 WIB) | `range=max` back to `firstTradeDate` (BBCA: 2004-06-08). `validRanges` 1d…max | ~1.5 KB per symbol per 5 days, so ~1.4 MB and **~900 requests** per daily run; backfill is ~900 one-time `range=max` calls | `indicators.quote[0]`: `open, high, low, close, volume`, plus `indicators.adjclose[0].adjclose` and `meta.regularMarketPrice/regularMarketTime/chartPreviousClose`. **No value, frequency or foreign buy/sell.** **Split-adjusted:** BBCA's Jan-2021 `close` is 6760, after the 5:1 split of 2021-10-13, and `adjclose` 5672 is also dividend-adjusted. `events.splits` and `events.dividends` are included. Per-symbol only. The batch `v7/finance/spark` returns `close` only. Served by `server: ATS` with `cache-control: max-age=10`. Accessed fine with the honest UA; Yahoo has no public API terms, so treat it as best-effort |
| **PARTIAL** | `GET https://pasardana.id/api/StockSearchResult/GetAll` (as in 5.1) | JSON | Daily (previous session) | Snapshot only | ~1 MB | `Last, PrevClosingPrice, AdjustedOpen/High/Low/ClosingPrice, Volume, Frequency, Value`, returns, `Per, Pbr, Roe, BetaOneYear`. Has **value and frequency**, which Yahoo lacks. No foreign. Good cross-check |
| PARTIAL | TradingView scanner (see Intraday) | JSON | Delayed 10 min | Snapshot only | ~130 KB per full-market POST | After the close this gives the session's OHLCV + `Value.Traded` for all 887 symbols in one request |
| NOT FOUND | Foreign buy/sell, whole market | — | — | — | — | No open source found. Options: an IDX data licence, arjum per-stock within quota, or IDX allowlisting the engine UA (§8) |

### 5.3 Indices (source 3)

| Status | Endpoint | Format | Update | History | Size/run | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| BLOCKED | IDX index summary | — | — | — | — | Cloudflare 403 |
| **OK (unofficial)** | Yahoo chart `…/v8/finance/chart/%5EJKSE?range=…&interval=1d` | JSON | As 5.2 | Long (`max`) | ~1 KB | IHSG (`^JKSE`) confirmed. Sector indices were not tested on Yahoo |
| **OK (unofficial)** | `POST https://scanner.tradingview.com/global/scan` with `{"symbols":{"tickers":["IDX:COMPOSITE","IDX:LQ45","IDX:IDXFINANCE","IDX:IDXENERGY",…]},"columns":["name","description","close","change","update_mode"]}` | JSON `{totalCount,data:[{s,d:[…]}]}` | Delayed 10 min (`update_mode: delayed_streaming_600`) | Snapshot only | <1 KB | IHSG, LQ45 and IDX-IC sector indices confirmed. Store the EOD row after the close |

### 5.4 Disclosures / keterbukaan informasi (source 4)

| Status | Endpoint | Format | Update | History | Size/run | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **BLOCKED** | IDX keterbukaan informasi / pengumuman | — | — | — | — | Cloudflare 403. No other official publisher mirrors IDX disclosures. Alternatives: IDX allowlist or data licence (§8), or headlines via news RSS (5.7) as a weak proxy |

### 5.5 Financial statements (source 5)

| Status | Endpoint | Format | Update | History | Size/run | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| BLOCKED | IDX financial reports (XBRL/PDF) | — | — | — | — | Cloudflare 403 |
| **PARTIAL (unofficial)** | `GET https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/<SYM>.JK?type=annualNetIncome,annualTotalAssets,quarterlyNetIncome,…&period1=<unix>&period2=<unix>` | JSON `timeseries.result[]` with `{asOfDate, periodType, reportedValue.raw}` | When reports are filed | ~4 annual + ~5 quarterly periods | <1 KB per metric set per symbol | BBCA FY2025 and Q2-2026 were present. No crumb or cookie needed. Usable for screener ratios (`per, pbv, roe, roa, eps, der`) |
| PARTIAL | Pasardana `GetAll` | JSON | Daily | Snapshot | (in 5.1) | Precomputed `Per, Pbr, Roe, PerAnnualized, PsrAnnualized, PcfrAnnualized` |

### 5.6 Corporate actions (source 6)

| Status | Endpoint | Format | Update | History | Size/run | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| BLOCKED | IDX / KSEI calendars | — | — | — | — | IDX: Cloudflare 403. KSEI: placeholder body or connect timeout (5.0). KSEI PDF notices at `/Announcement/Files/<SYM>_PROX_<yyyymmdd>_ID.pdf` were seen only in search results, not fetched |
| **PARTIAL (unofficial)** | Yahoo chart with `events=div%2Csplit` (5.2) | JSON `events.splits{date,numerator,denominator,splitRatio}`, `events.dividends{date,amount}` | After the ex-date | Full (BBCA: 22 dividends since 2016, split 5:1 on 2021-10-13) | Included in the price call | Ex-dates only: **no record/payment dates, no rights issues or warrants**. Enough for price adjustment |

### 5.7 News RSS (source 7)

| Status | Endpoint | Format | Update | History | Size/run | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **OK** | `https://www.cnbcindonesia.com/market/rss` | RSS 2.0 | Minutes (newest 10:40 WIB) | 100 items, about 2 days | 18 KB | Item: `title, link, guid, pubDate, description, enclosure, content:encoded`. Served by Cloudflare, no challenge |
| **OK** | `https://finance.detik.com/rss` | RSS 2.0 | Minutes | 100 items, about 2 days | 21 KB | Same item shape. General finance, not only the market |
| **OK** | `https://www.antaranews.com/rss/ekonomi-bursa.xml` | RSS 2.0 | Hours | 20 items, about 3 days | 4 KB | Stock-market channel. Has `last-modified` (good for conditional GET) |
| **OK** | `https://investortrust.id/rss/market.rss` (also `/rss/macro.rss`, listed in its `llms.txt`) | RSS 2.0 | Minutes | 10 items, a few hours | 7 KB | English. Fields: `title, link, guid, pubDate, author, description` |
| PARTIAL | `https://rss.tempo.co/bisnis` | RSS 2.0 | **Stale** (newest item 2026-09-14) | 50 items | 7 KB | Reachable but not updating. Skip |
| PARTIAL | Kontan: index page `https://www.kontan.co.id/rss` | HTML | — | — | — | Only `http://rss.kontan.co.id/…` feeds are linked, and the HTTPS guess `rss.kontan.co.id/news/investasi` failed to connect. The page says the feeds are **for individual / non-commercial sites**. Not used |
| **BLOCKED** | `https://www.bisnis.com/rss` | — | — | — | — | 403 with `cf-mitigated: challenge` (Cloudflare JS challenge) |
| **BLOCKED** | `https://investor.id/rss` | — | — | — | — | 403 from CloudFront ("Request blocked", `x-cache: Error from cloudfront`) |

Store headline + link + time + outlet only (§2).

### 5.8 Macro (source 8)

| Status | Endpoint | Format | Update | History | Size/run | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **OK** | `GET https://www.bi.go.id/id/statistik/indikator/bi-rate.aspx` | HTML table (ASP.NET WebForms) | After each Board of Governors meeting (monthly) | 10 rows per page. Older pages need a `__VIEWSTATE` postback | 143 KB | Columns: `No, Tanggal, BI-Rate, Pranala Siaran Pers`. Latest row: 23 Sep 2026, 5.75 %. No CSV/XLS link on the page |
| **OK** | `GET https://www.bi.go.id/id/statistik/informasi-kurs/jisdor/default.aspx` | HTML table | Business days (latest row was the previous day at 10:45 WIB) | 10 rows by default; a date-range form (postback) gives more | 139 KB | Columns: `Tanggal, Kurs` (for example `15 Oktober 2026, Rp17.948,00`). Parse the Indonesian number format |
| **PARTIAL (key needed)** | `GET https://webapi.bps.go.id/v1/api/list/model/<model>/domain/0000/key/<KEY>/` | JSON | Per release | Long | Small | Without a key: 200 `{"status":"Error","message":"Parameter Key is Missing."}`. A free key needs **registration at `https://webapi.bps.go.id/developer/`** (owner action; not registered) |
| **OK** | `GET https://www.worldbank.org/en/research/commodity-markets` → `CMO-Historical-Data-Monthly.xlsx` on `thedocs.worldbank.org` | XLSX (OOXML) | Monthly, early in the month (next release 2026-11-03) | ~65 years of monthly prices | ~570 KB | World Bank Commodity Price Data ("Pink Sheet"), **CC BY 4.0, commercial use allowed with attribution** (the file, not the API). Kept commodities match an IDX sector: coal, Brent, LNG, CPO, rubber, nickel, copper, tin, gold → `macro_observations` (`wb.*`). File URL carries a per-release hash (discovered from the landing page). Engine reach confirmed 2026-10-26 (200, honest UA). See research 2026-10-26-engine-data-sources §b row 31 |

### 5.9 KSEI ≥1% ownership lists (source 9)

| Status | Endpoint | Format | Update | History | Size/run | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| **BLOCKED** | IDX announcement PDF `/StaticData/NewsAndAnnouncement/ANNOUNCEMENTSTOCK/From_EREP/<yyyymm>/…pdf` | PDF | Monthly | Since Feb 2026 | ~73 pages | On idx.co.id, so Cloudflare 403. KSEI is not reachable either (5.0). This still needs the licence decision in CONNECTION-NETWORK.md, which now also covers access. Only legitimate routes: written permission + an IDX/KSEI feed, or a manual monthly download by the owner into the raw store |

### 5.10 Intraday (scope addition, 2026-10-16)

| Status | Endpoint | Format | Update during session | Delay | Whole-market payload | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| BLOCKED | IDX intraday / running trade pages | — | — | — | — | Cloudflare 403 |
| **OK (unofficial)** | `POST https://scanner.tradingview.com/indonesia/scan`, body `{"columns":["name","close","open","high","low","change","volume","Value.Traded","market_cap_basic","update_mode"],"range":[0,1000],"sort":{"sortBy":"Value.Traded","sortOrder":"desc"}}` | JSON `{totalCount:887, data:[{s:"IDX:BBCA", d:[…]}]}` | Continuous (cached; header `x-cache-level: hit1`) | **10 min**, stated per row as `update_mode: "delayed_streaming_600"` | ~130 KB for all 887 symbols in **one request** (~85 B/row measured with 10 columns) | Last, change %, OHLC, volume and value for the whole market. Bid/offer columns (`bid`, `ask`) exist in TradingView's column set but were not tested. No frequency, no foreign. Served behind CloudFront with no challenge. TradingView's terms restrict automated use and redistribution: internal experiment only, see §2 |
| **OK (unofficial)** | Yahoo chart `…/chart/<SYM>.JK?range=1d&interval=5m` and `…/chart/%5EJKSE?range=1d&interval=5m` | JSON | Bars of 1m/5m/15m | **~10 min** (`regularMarketTime` 10:36 WIB when fetched at about 10:46 WIB) | Per symbol, a few KB; not suited to whole-market polling | Good for single-stock intraday charts and IHSG intraday bars |
| **OK (unofficial)** | TradingView `global/scan` with an index ticker list (5.3) | JSON | Continuous | 10 min | <1 KB | Intraday IHSG, LQ45 and sector indices in one request |

### 5.11 Recommended first fetchers for E2/E3

1. **E2 prices: Yahoo chart (per symbol)** for daily OHLCV, split-adjusted candles, splits and dividends, and the
   history backfill (`range=max`, spread over several nights at one request every 2–3 s, about 900 calls).
   - Daily run: `range=5d&interval=1d` per symbol after 16:30 WIB. Upsert the last 5 bars so late corrections land.
   - Store raw `close` (already split-adjusted) and `adjclose`. Recompute our own adjustment from `events`.
   - **Plus one TradingView `indonesia/scan` call after the close** for the same-day universe (887 symbols), `value`,
     and a cross-check of close and volume.
   - **Plus one Pasardana `GetAll` pass** (paginated) for `Frequency`, sector/industry, `Capitalization`,
     `FreeFloatPct`, and ratios.
   - `foreignBuy/foreignSell` stay `null` (the contract allows it) until §8 Q5 is resolved. The foreign-flow signal
     (`/v1/signals`) and the HAKA-17 board/notation gate cannot be served from open sources.
2. **E2 universe:** TradingView symbol list ∪ Pasardana `Code` list, with sector data from Pasardana. Board and
   notation are marked unknown.
3. **E3 indices:** TradingView `global/scan` index list (IHSG, LQ45, IDX-IC sectors) every few minutes in-session and
   once after the close. Yahoo `^JKSE` gives IHSG history.
4. **E3 news:** CNBC Indonesia market, detik finance, Antara bursa, and InvestorTrust market + macro RSS, every
   15 min. Use conditional GET (ETag / Last-Modified) and store headline/link only.
5. **E3 macro:** BI-Rate and JISDOR HTML pages, daily (JISDOR) or after each meeting (BI-Rate). BPS once the owner
   registers a key.
6. **E3 corporate actions:** splits and dividends from Yahoo `events`. Rights, warrants, and record/payment dates
   are deferred (blocked).
7. **E3 disclosures and E6 ownership: no fetcher.** Both are blocked at IDX/KSEI and depend on §8 Q5.
8. **Intraday:** one TradingView `indonesia/scan` (whole market) plus one `global/scan` (indices) every **60 s** at
   most, only between 09:00–12:00 and 13:30–15:50 WIB (Friday 09:00–11:30 / 14:00–15:50).
   - The data is already 10 min delayed and served from cache, so polling faster gains nothing.
   - Back off to 5 min on any non-200 and stop with `SOURCE_BLOCKED` on 403/429.
   - Freshness is DELAYED with the row timestamp. Per-symbol Yahoo intraday bars are fetched on demand, not polled.

**Production data-rights gate (reviewed 2026-10-21):** the public IDX Ringkasan Saham page shows broad daily OHLC-like
data, but IDX's published terms prohibit web scraping/crawling and require prior written permission for commercial
use or distribution. Do not crawl that page or its underlying requests. The existing Yahoo, TradingView, and
Pasardana integrations are experimental sources; their presence in code or public accessibility does not grant
HAKAPRO collection, storage, or redistribution rights. Yahoo stays an internal source under the §2 block rules. No free, current,
full-market EOD source with verified terms for HAKAPRO production was established. BPS provides older annual market
statistics, OJK aggregate statistics, and BI FX data, but none replaces per-stock daily OHLCV. Ask the provider or
rights holder for terms covering server-side collection, storage, history, app display, and redistribution before
enabling a production source.

The existing authenticated arjum history API also returns per-stock OHLCV, value, frequency, and foreign-flow fields.
`ENGINE_ARJUM_EOD_ENABLED=1` promotes those rows to primary EOD and records source-specific session coverage under
the existing daily request budget/reserve. It is off by default and must remain off until the arjum plan/terms permit
this use. Its current 20-row request is a short rolling history, not a historical backfill; budget-limited coverage
is reported `PARTIAL`/`STALE` and must not be represented as a complete market session.

## 6. Data model (first cut)

- `sources`: id, host, policy (rate limit, schedule), status, last success/error, blocked_at.
- `raw_documents`: id, source, url, fetched_at, http_status, sha256, r2_key, content_type, parse_status.
- `securities`: symbol, name, board, notation, sector, listing_date, shares_outstanding, active.
- `daily_prices`: symbol, date, open/high/low/close, volume, value, frequency, foreign buy/sell, source, raw_ref. Primary key (symbol, date).
- `index_daily`: code, date, OHLC/close, change.
- `announcements`: id, symbol, published_at, title, category, document_url, raw_ref.
- `news_items`: id, published_at, title, url, outlet, symbols[].
- `corporate_actions`: symbol, type, ex/record/payment dates, ratio/amount, source.
- `financials`: symbol, period_end, period_type (annual | quarterly), metric, value, unit, currency, source, as_of, raw_ref (built in E5).
- `stock_ratios`: symbol, ratio, ratio_source (derived | pasardana), value, date, basis, inputs, derivation version (built in E5).
- `ownership_snapshots`: per the HAKA-33 types, with a parent snapshot-set table. Built in E6 as `ownership_uploads`, `ownership_snapshot_sets`, `ownership_snapshot_rows` and `ownership_changes` (see `services/engine/README.md` → Ownership uploads).
- `scan_runs`, `scan_candidates` (E4): one strategy scan per (session, rules version) with its parameters, universe counts and gate failures; its candidates with strategy, symbol, session, rules version, rank, reasons, metrics, source `HAKAPRO_EOD_ENGINE` and as-of.

Every table has `source` and `as_of`; derived tables also record the derivation version.

## 7. Phases (Plane module "Data Engine")

| Phase | Work |
| --- | --- |
| E0. Discovery | Confirm endpoints, formats, update times and block behaviour for sources 1–9 with single requests. **Done 2026-10-16, see §5** |
| E1. Foundation | `services/engine` (Bun, Dockerfile, health), engine DB + Drizzle, fetcher framework (policy, cache, raw store, block detection), scheduler, `/v1/meta/health`. Coolify environment `data-engine` with app + DB |
| E2. Universe + EOD prices | Experimental integrations and `/v1/securities`, `/v1/stocks/{s}`, `/v1/market` are built. A production data provider and reuse rights remain unresolved; the Yahoo backfill path is blocked in production. Arjum can supply limited rolling EOD only after its entitlement explicitly allows storage/display. Do not claim production market coverage until the selected provider's terms, field coverage, and full-universe session coverage are confirmed. |
| E2b. Intraday snapshots | Session-window polling (default 5 min) for quotes and indices, `intraday_snapshots` with 30-day retention, intraday movers/breadth served as DELAYED on `/v1/market` and `/v1/stocks/{s}`. **Built 2026-10-16** (HAKA-67) |
| E3. Market info | Indices, announcements, news, corporate actions, macro → `/v1/market`, `/v1/news`, `/v1/announcements`, `/v1/stocks/{s}/actions`. **Built 2026-10-16** (HAKA-63): news RSS from the four §5.7 outlets every 15 min (06:00–22:00 WIB) → `/v1/news`; BI-Rate + JISDOR daily → `/v1/macro`; the Yahoo-event calendar → `/v1/actions`; announcements stay `UNAVAILABLE` (IDX blocked), explained on `/v1/meta/health`. See `services/engine/README.md` |
| E4. Strategy scans | `HAKAPRO_EOD_ENGINE` running the approved HAKA-17 rules over the whole universe, exposed via the HAKA-18 contract. **Built 2026-10-16 on the DRAFT v0.1 rules** (HAKA-64; PR #4 is not approved yet), behind `ENGINE_STRATEGY_SCANS_ENABLED` (engine) and `STRATEGY_ENGINE_ENABLED=1` (app), both off by default: `strategy-scan-eod` (21:00/23:00 WIB once `eod_sessions` is `COMPLETE`, or on demand) runs BREAKOUT and BB REVERSAL behind gate G over `daily_prices`, stores `scan_runs`/`scan_candidates` with `rulesVersion: "0.1-draft"`, and serves `/v1/strategies`; the app's `engineStrategySource` merges it after the arjum screener as `eod-breakout`/`eod-bb-reversal`. ARA HUNTER, HAKA SORE/BSJP, HAKA PAGI and SCALPING are not built (HAKA-25, HAKA-14/15) and listed on `/v1/meta/health`. Re-version the rules when the owner approves or corrects them. See `services/engine/README.md` |
| E5. Fundamentals + screener | Financial statements → fundamentals and `POST /v1/screener`. **Built 2026-10-16** (HAKA-65): Yahoo fundamentals timeseries per symbol (annual + quarterly statement lines) → `financials`, a weekly night refresh as a low-priority background job plus an earnings-season catch-up; derived PER/PBV/ROE/ROA/EPS/DER/dividend yield (TTM, documented formulas) → `stock_ratios`, with Pasardana's own PER/PBV/ROE kept as a secondary source (never blended); `/v1/stocks/{s}/fundamentals` and `POST /v1/screener` over the newest session. See `services/engine/README.md` |
| E6. Ownership | Monthly ≥1% lists → HAKA-33 change engine and HAKA-34 estimate (draft until approved). **Built 2026-10-16** (HAKA-66): the owner uploads the month's PDF (or a CSV/XLSX export) to `POST /v1/admin/ownership/upload` (§8.5d; nothing is fetched from IDX/KSEI); raw copy with sha256 dedupe; a header-driven PDF table parser (unpdf) with per-row validation errors; snapshot sets per issuer filling the HAKA-33 schema gap; changes against the adjacent previous month; the free-float estimate stored as a draft and served only with `ENGINE_FREE_FLOAT_ENABLED=1`. Served on `/v1/stocks/{s}/ownership` and `/v1/ownership/changes?month=`. Designed against the documented column layout and tested on synthetic files only: the layout must be checked on the first real PDF. The engine has no public domain, so uploads go through the private network until the owner sets up an admin-only route. See `services/engine/README.md` |

## 8. Decisions (owner, 2026-10-16)

1. **Raw store:** a new R2 bucket, `hakapro-engine-raw` (created 2026-10-16), with its own bucket-scoped token (Object Read & Write, owner creates it). It is not shared with `heulaulab-db-backups`.
2. **EOD history:** backfill from **2020-01-01**, matching arjum's daily history. The backfill runs gradually at night and never competes with the daily run.
3. **Intraday: yes, alongside EOD** (corrected by the owner the same day). Discovery: TradingView's scanner gives the whole market in one call, already 10 min delayed (§5.10), so polling faster than every 60 s gains nothing; the default stays 5 min. The engine polls intraday snapshots during IDX sessions: the default is every 5 minutes, configurable per source, with jobs only inside session windows from the IDX calendar. These snapshots are stored as `intraday_snapshots` (symbol, ts, last, change, volume, value, frequency, bid/offer if available, source, raw_ref), served as **DELAYED** with their timestamp and never LIVE, and kept for a limited window (default 30 days; EOD rows are the permanent record). Intraday polling counts against the server safeguards (§4): it pauses during builds and above the disk threshold, with concurrency 1 per host. Running Trade (HAKA-14/15) stays the path for true streaming.
4. **Deployment:** **one shared engine** during the experiment. It runs in its own Coolify environment `data-engine` (app `hakapro-engine`, PostgreSQL `hakapro-engine-postgres`) and serves develop, staging and production over the private network (`MARKET_API_URL`). Per-environment engines can come later if needed.

### Decisions after discovery (owner, 2026-10-16)

5. **IDX/KSEI access:** **(c) and (d)**. Neither (a) an IDX allowlist request nor (b) a licence for now.
   - **(c) Foreign flow from arjum.** A nightly job takes per-stock foreign buy/sell from arjum's documented endpoints for the most liquid stocks first, ranked by the previous session's value. It is capped by `ENGINE_ARJUM_DAILY_BUDGET` (default **600** of the shared 1000/day quota, leaving about 400 for the three app environments). The job reads arjum's `x-ratelimit-*` headers and stops early when remaining quota drops below the app's reserve. Stocks it doesn't reach keep `foreignBuy`/`foreignSell` null for that day. `/v1/signals` is served from this data.
   - **(d) ≥1% ownership by manual download.** The owner downloads the monthly ≥1% PDF and uploads it through an admin endpoint, `POST /v1/admin/ownership/upload`, which stores it in the raw store. The engine parses it into snapshot sets for the HAKA-33 engine (E6). Nothing is fetched from IDX or KSEI.
   - Disclosures, board/notation and the full corporate-action calendar stay unavailable until (a) or (b). The HAKA-17 eligibility gate treats board/notation as unknown.
6. **Unofficial sources accepted** for the internal experiment: Yahoo chart/fundamentals, TradingView scanner and Pasardana. Each has block detection and falls back to another source or to arjum where possible. None of these may back a public or paid HAKAPRO; that needs (b).
7. **BPS:** set up later. E3 ships BI-Rate/JISDOR without BPS until the owner registers a key.
