# HAKAPRO Data Engine (`services/engine`)

Experimental internal collector and API for IDX data. Spec: [`docs/features/DATA-ENGINE.md`](../../docs/features/DATA-ENGINE.md).

- E1 (HAKA-61): the foundation (fetcher, raw store, scheduler, health).
- E2 (HAKA-62): universe, EOD prices, the 2020-01-01 backfill, index EOD and arjum foreign flow, served on the idx-bei `/v1` contract.
- E2b (HAKA-67): session-window intraday snapshots, served as `DELAYED`.
- E3 (HAKA-63): market info: news RSS headlines, BI-Rate and JISDOR, the market-wide corporate-action calendar; announcements stay unavailable (IDX blocked).
- E5 (HAKA-65): financial statements from Yahoo fundamentals timeseries, derived valuation ratios (with Pasardana's own as a secondary source), `/v1/stocks/{s}/fundamentals` and `POST /v1/screener`.
- E6 (HAKA-66): ownership. The owner uploads the monthly KSEI ≥1% shareholder list (PDF, or a CSV/XLSX export); the engine parses it into HAKA-33 snapshot sets, computes month-over-month changes and a draft HAKA-34 free-float estimate. Nothing is fetched from IDX or KSEI. See [Ownership uploads](#ownership-uploads-e6).
- E4 (HAKA-64): strategy scans on the HAKA-17 **draft** rules (BREAKOUT, BB REVERSAL) over the whole active universe, served as a HAKA-18 board on `/v1/strategies`. Off by default (`ENGINE_STRATEGY_SCANS_ENABLED`).

It is a separate Bun + TypeScript service with no Next.js. It shares code with the app through the `@/*` path: the idx-bei and arjum Zod contracts (`src/server/schemas/`), the arjum URL builder, the IDX calendar, the freshness clock, the arjum page limits and the movers ranking.

## Layout

| Path | What |
| --- | --- |
| `src/main.ts` | Entry: `Bun.serve` on `PORT`, scheduler start, graceful SIGTERM |
| `src/engine.ts` | Wiring: DB, raw store, fetcher, the production registry (sources + jobs), scheduler, HTTP handler |
| `src/sources/` | One module per source: URL/body builders and parsers (TradingView, Yahoo, Pasardana, arjum, the news feeds, Bank Indonesia), a small RSS/Atom reader, source policies, IDX session dates |
| `src/jobs/` | Collection jobs: `universe`, `indices-eod`, `eod-daily`, `eod-backfill`, `foreign-flow`, `insider-feed`, `intraday`, `news`, `macro-jisdor`, `macro-bi-rate`, `fundamentals`; the `ratios` and `strategy-scan-eod` derivations |
| `src/derive/` | Pure derivations: valuation ratios from statement lines (`ratios.ts`, formulas in its header) |
| `src/strategies/` | E4 strategy rules: the versioned draft parameters (`rules.ts`), gate G, BREAKOUT, BB REVERSAL, the universe scan, the catalog of built / not-built strategies and the wording guard. Pure functions |
| `src/db/ingest.ts`, `src/db/market-info.ts`, `src/db/fundamentals.ts`, `src/db/market-store.ts` | Idempotent upserts with source precedence (prices) and dedupe (news); statement lines and ratios; the read store behind `/v1` |
| `src/db/strategy-store.ts` | Scan inputs from `daily_prices`/`securities`/`corporate_actions`, scan run writes (`scan_runs`, `scan_candidates`) and their read port |
| `src/serve/` | Builds `/v1` payloads (quote, candles, breadth, movers, indices, foreign-flow signals, actions, news, macro, the actions calendar, fundamentals, the screener, the strategy board) from stored rows |
| `src/http/` | Routes (`/health`, `/ready`, `/v1/meta/health`, `/v1/admin/*`, idx-bei `/v1/*`) and the `{data, meta}` envelope |
| `src/fetch/` | Polite fetcher: per-host token bucket and concurrency, honest UA, ETag/Last-Modified, URL+sha256 dedupe, raw store (R2/S3 or local), block detection |
| `src/schedule/` | WIB cron, IDX session windows, disk/flag pause, single-flight scheduler, resumable backfill helpers (per day and per item) |
| `src/registry.ts` | Source/job registry (`defineSource`, intraday retention job) |
| `src/ownership/` | E6: upload service, parsers (`pdf.ts`, `tabular.ts` for CSV/XLSX), the ≥1% column layout (`layout.ts`), number/date parsing, normalization into HAKA-33 rows, derivations (changes, draft free float), the store port |
| `src/db/ownership.ts`, `src/serve/ownership.ts`, `src/http/ownership-admin.ts` | E6 storage, `/v1` payloads, admin routes |
| `src/db/insiders.ts`, `src/serve/insiders.ts` | Insider feed: `insider_transactions` (deduplicated), `insider_checks` (per-symbol reads: rotation and coverage), `/v1/insiders/recent` |
| `db/schema.ts`, `db/migrations/` | Engine Drizzle schema and generated SQL |
| `test/` | Recorded source fixtures, the local fixture world, and the Docker e2e suites |

## Rules the code enforces (§2)

- One fixed user agent: `HAKAPRO-DataEngine/0.1 (+https://hakapro.heulaulab.xyz)`. No UA rotation, proxies, challenge solving or browser automation.
- Per-host limits: by default 1 request per 2 s and 2 in flight (`ENGINE_FETCH_*`). Intraday sources are forced to 1 in flight.
- A Cloudflare challenge, any **403** (`CDN_FORBIDDEN` with `cf-ray` or CloudFront headers, otherwise `FORBIDDEN`), a captcha, a login redirect or 401, or a **429** marks the source `BLOCKED`. The engine stores evidence (reason, status, allow-listed headers, markers), logs `SOURCE_BLOCKED`, and stops the source. Nothing is retried within a run.
- A **429** (`RATE_LIMITED`) rests the source on a cooldown: 2 h, then 6 h, 24 h and 72 h for rate limits less than a week apart, or the server's `Retry-After` if later. When it ends, the block lifts (status `ERROR` until the next success) and the next scheduled run may fetch again. A fifth 429 in a row has no cooldown. `/v1/meta/health` shows `retryAt` and `strike` for a rate-limited source. A 429 stored before the cooldown existed counts as a first strike.
- Every other block, and a 429 past the ladder, stays until `POST /v1/admin/sources/{id}/unblock`.
- Extra request headers are only for a documented credential (arjum `x-api-key`) or a content type. The fetcher refuses user-agent, cookie, conditional and forwarding headers, never stores the credential, and never follows a redirect with it (or with a POST).
- Backoff (2 s, 4 s, 8 s; 4 attempts) applies only to 5xx responses and network errors.
- Every new document is stored raw (`<source>/<YYYY-MM-DD>/<sha256>.<ext>`) and indexed in `raw_documents`. A 304 or identical bytes stores nothing new. A POST (TradingView's scanner) is indexed as its URL plus `#post-<body hash>`.
- Every data row has `source`, `as_of` and `raw_ref`. On `daily_prices`, those describe the OHLCV; value/frequency (`value_source`, `value_raw_ref`) and foreign flow (`foreign_source`, `foreign_as_of`, `foreign_raw_ref`) keep their own provenance. Intraday data is served as `DELAYED` with its timestamp, never `LIVE`.

## Sources and jobs (E2, E2b, E3, E5)

Yahoo, TradingView, and Pasardana are unofficial sources and are for internal experiments only. Arjum is an authenticated provider; its plan must explicitly permit HAKAPRO's collection, storage, and display before its rows are used as production EOD. Public access, an API key, or an existing app integration alone does not establish redistribution rights. The news feeds are used for headline + link only; BI is a separate macro source.

| Source id | Host | Policy | Used for |
| --- | --- | --- | --- |
| `tradingview-scanner` | `scanner.tradingview.com` | 1 request / 2 s, 1 in flight | Universe, session values, index EOD, intraday (10 min delayed) |
| `yahoo-chart` | `query1.finance.yahoo.com` | 1 request / 5 s, 1 in flight | Daily OHLCV (`range=5d`), history from 2020-01-01, splits/dividends, IHSG `^JKSE` |
| `yahoo-fundamentals` | `query1.finance.yahoo.com` (same limiter as the chart) | 1 request / 5 s, 1 in flight, shared with `yahoo-chart` | `/ws/fundamentals-timeseries/v1/finance/timeseries/<SYM>.JK`: 26 statement lines, annual + quarterly, one request per symbol |
| `pasardana` | `pasardana.id` | 1 request / 3 s, 1 in flight | Sectors (IDX-IC), capitalisation, shares, free float, previous-session value/frequency |
| `arjum` | from `ENGINE_ARJUM_BASE_URL` | 1 request / 2 s, 1 in flight | Foreign buy/sell; optionally primary EOD OHLCV/value/frequency via the same history response when `ENGINE_ARJUM_EOD_ENABLED=1` and the provider entitlement permits storage and app display. With `ENGINE_ARJUM_INSIDER_BUDGET > 0`, also `/api/insiders/{code}` page 1 for the insider feed |
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
| `eod-daily` | 16:45, 18:45, 20:45, trading days | Yahoo `range=5d` per active symbol, most liquid first, plus `^JKSE` (~900 calls ≈ 75 min at 5 s). Later runs fetch only symbols still missing the session's Yahoo row. The 20:45 run (or any run after the session day) is final: `eod_sessions` becomes `COMPLETE` or `STALE` |
| `foreign-flow` | 19:00, 21:00, trading days | arjum, most liquid first by the session's value. Stops at `ENGINE_ARJUM_DAILY_BUDGET` calls per WIB day (counted in `job_cursors` across runs), when `x-ratelimit-remaining` drops below `ENGINE_ARJUM_RESERVE`, or on a 429/401/403 (source `BLOCKED`). Unreached stocks keep `foreignBuy/foreignSell` null |
| `insider-feed` | Every 10 min, 21:30–23:30, every day, background; only with `ENGINE_ARJUM_INSIDER_BUDGET > 0` (default 0: not registered) | arjum `/api/insiders/{code}?page=1&limit=15` (the newest 15 filings) per active symbol → `insider_transactions` (natural key symbol + date + person + action + share change + shares after, NULLs equal, so a re-read updates rows instead of adding them) and `insider_checks` (read date per symbol). Rotation: never-read symbols first, then the longest ago, most liquid first within each; a symbol is re-read at most once per `ENGINE_ARJUM_INSIDER_REVISIT_DAYS` (default 7). Stops at `ENGINE_ARJUM_INSIDER_BUDGET` calls per WIB day (`job_cursors`), when `x-ratelimit-remaining` is at or below `ENGINE_ARJUM_RESERVE` (the value is kept in the cursor, so no later run that day probes again), or on a 429/401/403 (source `BLOCKED`, shared with `foreign-flow`). An unknown code (404) is recorded as read. See "arjum quota" |
| `eod-backfill` | Every 10 min, 19:00–05:59, background | One Yahoo call per symbol (and `^JKSE`) from 2020-01-01 up to the session the daily job owns, 10 per run. The cursor lists finished symbols, so new listings join automatically. Yields to every other job |
| `intraday-retention` | 02:30, background | Prunes `intraday_snapshots` and `index_intraday` past `ENGINE_INTRADAY_RETENTION_DAYS` |
| `news` | Every `ENGINE_NEWS_INTERVAL_MINUTES` (default 15, minimum 5) from 06:00 to 22:00, every day | One conditional GET per feed (ETag / Last-Modified; a 304 or identical bytes adds nothing) → `news_items`. Each outlet is its own source: a block stops that outlet only. Items older than the retention window are not stored |
| `news-retention` | 02:45, background | Prunes `news_items` published before `ENGINE_NEWS_RETENTION_DAYS` (default 180) |
| `macro-jisdor` | 17:00 daily | BI JISDOR table, first page (latest 10 business days) → `macro_observations` |
| `macro-bi-rate` | 17:05 daily | BI-Rate table, first page (latest 10 decisions, with the press-release link) → `macro_observations` |
| `fundamentals` | Every 10 min at :05, 19:00–05:59, every day, background **low priority** | Yahoo fundamentals, 10 symbols per run, most liquid first → `financials`. Weekly full cycle (ISO week, Monday WIB; ~900 calls over about two nights). From Thursday to Sunday inside the filing windows (15 Mar–10 May, 15 Jul–10 Aug, 15 Oct–10 Nov) a catch-up pass refetches only symbols whose newest stored quarter is older than the expected one (the newest quarter end ≥ 21 days ago). Cursor in `job_cursors`; gives way to every other job, including the EOD backfill |
| `ratios` | 06:15, 17:15, 21:15 daily | No network: derived ratios for every symbol with statement lines → `stock_ratios` (`derived`); ratios whose inputs are now missing are removed |
| `strategy-scan-eod` | 21:00 and 23:00, trading days; only with `ENGINE_STRATEGY_SCANS_ENABLED` | Reads stored rows only (no source). Scans the last completed session once its `eod_sessions` status is `COMPLETE`; otherwise records a `SKIPPED` run with the reason. A scheduled run skips a session already scanned; `POST /v1/admin/jobs/strategy-scan-eod/run` recomputes it in place. See "Strategy scans" |

### arjum quota (foreign flow vs insider feed vs the app)

One arjum key has **1000 calls per day**, shared by the engine and every app environment. `ENGINE_ARJUM_RESERVE` (default 400) is the app's share: both engine jobs stop while `x-ratelimit-remaining` is at (insider feed) or below (foreign flow) it. The engine's own spend is two budgets, and the engine refuses to start when they cannot both fit above the reserve:

```
ENGINE_ARJUM_DAILY_BUDGET + ENGINE_ARJUM_INSIDER_BUDGET ≤ 1000 − ENGINE_ARJUM_RESERVE      (checked when the insider budget > 0)
```

With the defaults (600 + 0 ≤ 600) there is no room: **every insider call comes out of foreign-flow coverage or the app's reserve**. The trade-off, for ~950 active stocks:

| Split (foreign / insider / reserve) | Foreign flow per session | Insider feed: full rotation | App's share |
| --- | --- | --- | --- |
| 600 / 0 / 400 (default) | the 600 most liquid stocks | off | 400 |
| 500 / 100 / 400 | the 500 most liquid stocks | ~10 days (each stock read every ~10 days) | 400 |
| 450 / 150 / 400 | the 450 most liquid stocks | ~7 days, matching the 7-day feed window | 400 |
| 600 / 100 / 300 | unchanged | ~10 days | 300 |

Foreign flow fills the most liquid stocks first, so lowering its budget drops the least traded ones. The insider budget sets how fresh the market-wide feed is: a stock is read about every `active ÷ budget` days (never more often than the revisit window), and `/v1/insiders/recent` states its coverage so the app never implies a complete view. Leave `ENGINE_ARJUM_INSIDER_BUDGET` at 0 until the owner picks a split.

Precedence: Yahoo is the primary OHLC source for stocks and overwrites TradingView/Pasardana/arjum fallback rows, but never their value/frequency. Pasardana's value/frequency replace TradingView's value. TradingView is primary for `index_daily`; Yahoo `^JKSE` only fills gaps. A fallback source refreshes only rows it wrote itself.

News items (`news_items`) keep: the headline, the canonical link (lower-case host, no fragment or `utm_*`-style tracking parameters), `published_at` (RSS/Atom dates with their zone; a date without a zone is read as WIB; missing, unparseable or more than an hour in the future → the fetch time with `published_at_estimated = true`), the outlet, a summary only when the feed itself has a description (HTML stripped, at most 280 characters; `content:encoded` is never read) and matched symbols. The engine never fetches an article page. Dedupe: the canonical URL is unique, and the same normalized title within 3 days (any outlet) is one story. Symbols: `$BBCA` always counts when the symbol is in `securities`; a bare upper-case four-letter word counts only when it is in `securities`, not on `SYMBOL_STOPLIST` (common words, brands and abbreviations such as `BANK`, `DATA`, `IHSG`, `MSCI`) and the text is not written in capitals.

Macro rows (`macro_observations`) are `(series, date)`: `BI_RATE` in percent and `JISDOR` in IDR per USD. Only the first table page is read: older rows need an ASP.NET `__VIEWSTATE` postback, which the engine does not do. A table that changes shape fails the parse (raw copy `FAILED`) instead of storing guesses. BPS is deferred until the owner registers a key (§8.7).

### Fundamentals and ratios (E5)

`financials` keeps one row per (symbol, period end, `annual`|`quarterly`, metric, source), as reported: `amount` lines in the filing `currency` (IDR, or USD for some coal/energy filers), `per_share` lines (EPS) in that currency per share, `shares` lines without a currency. Quarterly rows are discrete quarters; balance-sheet lines are period-end values. Metric keys: `revenue`, `grossProfit`, `operatingIncome`, `pretaxIncome`, `ebitda`, `netIncome` (owners of the parent), `netIncomeCommon`, `epsBasic`, `epsDiluted`, `averageSharesBasic`, `averageSharesDiluted`, `totalAssets`, `totalLiabilities` (net of minority interest), `equity` (parent), `totalEquity` (incl. NCI), `totalDebt`, `cash`, `currentAssets`, `currentLiabilities`, `sharesOutstanding`, `sharesIssued`, `operatingCashFlow`, `capitalExpenditure`, `freeCashFlow`, `dividendsPaid`, `commonDividendsPaid` (cash-flow signs as reported). A line Yahoo leaves empty (a bank's gross profit) is not stored; a later fetch replaces a period's value (restatements). Yahoo returns ~4 annual and ~5 quarterly periods and sometimes skips a quarter (BBCA has no Q3-2025); older periods stay stored as the window moves.

The `ratios` job (`src/derive/ratios.ts`, `ratios-v1`) stores, per symbol, `per`, `pbv`, `roe`, `roa`, `eps`, `der` and `dividendYield` as `derived` rows in `stock_ratios`, with the price date, the basis (`ttm-4q:<end>`, `ttm-ytd:<end>`, `annual:<end>`, `balance:<end>`, `dividends-365d`), the inputs and the provenance of the newest statement row used:

| Ratio | Formula | Null when |
| --- | --- | --- |
| `eps` | NI_TTM × fx / shares (IDR per share) | inputs missing |
| `per` | price / eps | eps ≤ 0 (`NON_POSITIVE_EARNINGS`) |
| `pbv` | price / (equity × fx / shares) | equity ≤ 0 (`NON_POSITIVE_EQUITY`) |
| `roe` | NI_TTM / equity (fraction) | equity ≤ 0 |
| `roa` | NI_TTM / totalAssets (fraction) | assets ≤ 0 |
| `der` | totalLiabilities / totalEquity (multiple) | totalEquity ≤ 0 |
| `dividendYield` | cash dividends per share with an ex-date in the 365 days to the price date / price (fraction) | — (0 when the stored Yahoo price history covers the window and nothing went ex); without that coverage: \|dividends paid TTM\| × fx / (price × shares) |

- NI_TTM: the four consecutive quarters ending at the newest quarter; else last annual + this fiscal year's quarters − the same quarters a year earlier; else the newest annual. Balance-sheet lines: the newest period end. Inputs whose period ended more than 550 days before the price date count as missing.
- price: the symbol's newest close at or before the newest session. shares: listed shares from the universe (Pasardana), else the statements' `sharesOutstanding`. fx: 1 for IDR; JISDOR on or before the price date for USD filers; any other currency has no price-based ratios. ROE/ROA/DER need no FX.
- `missing` ratios are not stored (and an older derived row is removed); `not_meaningful` ones are stored as null with a note.

Pasardana's own `Per`, `Pbr` and `Roe` (a fraction) are stored by the `universe` job as `pasardana` rows (date = its `LastDate`, provenance = the GetAll page), with PER/PBV ≤ 0 stored as null. The screener uses the `derived` row whenever one exists (even a null one) and Pasardana's only otherwise: one source per ratio, never blended, and the response says which (`ratioSources`).

Fallbacks when a source is `BLOCKED`: universe from Pasardana (or TradingView); session rows from TradingView/Pasardana (and arjum) when Yahoo is blocked; IHSG from Yahoo when TradingView is blocked. Intraday has no fallback: `/v1` then serves the latest EOD. Fundamentals have no second statement source (IDX is blocked): while `yahoo-fundamentals` is blocked, stored statements and ratios keep serving, and the screener falls back to Pasardana's ratios only where no derived row exists. Yahoo's two sources share one host, so a 429 on the fundamentals path also rests `yahoo-chart` for the same cooldown, and `fundamentals` refuses to run while `yahoo-chart` is blocked.

## Strategy scans (E4, HAKA-64, draft rules)

**The rules are the HAKA-17 DRAFT v0.1** (`docs/features/STRATEGY-RULES.md`, PR #4, not approved). Everything is behind `ENGINE_STRATEGY_SCANS_ENABLED` (default off) on the engine and `STRATEGY_ENGINE_ENABLED=1` (default off) in the app.

- **Built:** BREAKOUT (§4) and BB REVERSAL (§5), the EOD-feasible strategies, after the common gate G (§3.3). **Not built:** ARA HUNTER, HAKA SORE/BSJP, HAKA PAGI and SCALPING INTRADAY. They need HAKA-25 (tick sizes, price limits) or the Running Trade tape (HAKA-14/15); `/v1/meta/health` lists them as `NOT_BUILT` with the reason.
- **Parameters:** one frozen object, `STRATEGY_RULES` in `src/strategies/rules.ts`, `rulesVersion: "0.1-draft"`, with the draft's defaults unchanged. Every run stores the full parameter object (`scan_runs.parameters`), and every candidate stores `rules_version`. Changing any value means a new version.
  - Gate G: `minHistory` 60 sessions; traded on 18 of the 20 sessions before t; 20-session average value ≥ Rp 1 bn; close ≥ Rp 100; consistent OHLC on every row read; watchlist/acceleration board or special notation excluded; no split ex-date in the rows read.
  - BREAKOUT: N = 20; RVOL (20-session) ≥ 2.0; close location ≥ 0.5; first break required; base range off.
  - BB REVERSAL: period 20, k = 2 population σ, pierce window 3, pierce by close, bandwidth ≥ 4%, close above the open.
- **Data the gate can't see yet:** no source reports board or special notation, so every candidate carries `boardKnown = 0` and a note. It is never silently treated as the main board (the draft's default for unknown). Rights and bonus issues have no source; only Yahoo splits feed G8. Yahoo history rows have no traded value, so the value of such a session is `close × volume`, as in the draft's own test tables, with a note on the candidate.
- **Determinism:** pure functions; thresholds inclusive with a 1e-9 float tolerance; candidates sorted by the strategy's key (BREAKOUT `breakoutPercent` desc, BB REVERSAL `percentB` asc), then symbol.
- **Storage:** `scan_runs` holds one row per (session, rules version), replaced on re-run: status `SUCCEEDED`/`SKIPPED`, skip reason, parameters, universe counts, gate failures by rule, misses by rule, `source = HAKAPRO_EOD_ENGINE`, `as_of`. `scan_candidates` holds strategy, symbol, session, rules version, rank, `reasons[]`, `metrics[]`, source and `as_of`.
- **Wording:** reasons are HAKA-18 `criterion` keys, worded by the app in en/id, plus English `note`s with the observed numbers and dates. There is no score. Labels, descriptions and notes go through a forbidden-wording guard (no buy/sell/entry/target/signal/potensi/win rate/drawdown/arrows) in the tests.
- **App:** `engineStrategySource` (`src/server/strategies/engine-eod.ts`) reads `/v1/strategies` through `IdxBeiSource.engineStrategies()` and prefixes ids (`eod-breakout`, `eod-bb-reversal`). It is registered after the arjum screener only when `STRATEGY_ENGINE_ENABLED=1`. An unreachable engine contributes nothing and doesn't change the board's freshness.

## Scheduler

- **Cron jobs** run on five-field cron in Asia/Jakarta. `tradingDaysOnly` skips weekends and IDX holidays (for EOD jobs).
- **Session jobs** (`{ kind: "session", everyMinutes }`, default 5 via `ENGINE_INTRADAY_INTERVAL_MINUTES`) run only inside IDX session windows, including the Friday times. They run at each session start, every N minutes, and at each session end. They never run during the lunch break or on non-trading days.
- Each job is **single-flight**. Manual runs skip the calendar check, but not the pause or a block.
- **Background jobs** (`background: true`: the backfill and retention) never start while another job runs. Once one does, `ctx.shouldYield()` turns true and they stop at the next batch boundary.
- **Low-priority background jobs** (`lowPriority: true`: `fundamentals`) also give way to other background jobs: they never start while any other job runs, and yield as soon as one starts. `backfillJob()` (per day) and `itemBackfillJob()` (per symbol, used by `eod-backfill`) run from 2020-01-01 in small batches in a night window (`*/10 19-23,0-5 * * *` WIB). Their cursor is stored in `job_cursors`, so runs resume where they stopped. They stop at the day the daily EOD job owns.
- **Global pause:**
  - when disk use on `ENGINE_DATA_DIR` (statfs) goes above `ENGINE_DISK_STOP_PERCENT`, or cannot be measured;
  - while the flag file `${ENGINE_DATA_DIR}/PAUSE` exists. `POST /v1/admin/pause` and `/resume` set and clear it; use them during Coolify builds or maintenance.
- `intraday-retention` runs daily at 02:30 WIB and deletes `intraday_snapshots` and `index_intraday` rows older than `ENGINE_INTRADAY_RETENTION_DAYS`, in batches.

## HTTP

| Route | Auth | Notes |
| --- | --- | --- |
| `GET /health` | none | Liveness |
| `GET /ready` | none | 200 when the DB answers within 4 s and the disk is at or below the stop threshold, otherwise 503 |
| `GET /v1/meta/health` | API token | Per source: status, blocked/reason, last success/error, rows ingested. Also scheduler pause, disk %, jobs, raw store kind, the last EOD sessions (`COMPLETE`/`PARTIAL`/`STALE`, expected/present) and `unavailable`: the routes served empty on purpose and why (`SOURCE_BLOCKED` announcements and profile, `DISABLED` strategies while the flag is off). `strategyScans`: the flag, the rules version (`0.1-draft`, `DRAFT_NOT_APPROVED`), the built strategies, the four `NOT_BUILT` ones with the reason, and the last scan runs (status, skip reason, universe counts, gate failures by rule) |
| `GET /v1/securities?q=` | API token | Active securities by symbol prefix or name (all when `q` is empty) |
| `GET /v1/stocks/{s}?limit=` | API token | Quote from the newest daily row (`EOD`/`STALE`), or from an intraday snapshot of a newer session (`DELAYED`, WIB timestamp). Daily candles, oldest first, up to `limit` (default 500, max 5000). `404 NO_DATA` without data |
| `GET /v1/market` | API token | Indices (intraday when newer), breadth (advancers/decliners/unchanged, value, volume, frequency) and movers (top 50 gainers, losers and most active, same liquidity rule as the app) from the latest session or intraday snapshot |
| `GET /v1/signals` | API token | Foreign-flow radar from arjum data: per stock, the run of same-direction net foreign sessions ending on the newest session, its total, % of free float and average value. `404 NO_DATA` until foreign data exists |
| `GET /v1/stocks/{s}/actions` | API token | Splits and cash dividends (ex-dates) from Yahoo events |
| `GET /v1/actions?from=&to=` | API token | Market-wide calendar by ex-date, oldest first (`actionsCalendarSchema`): symbol, date, type, description, amount, ratio. Default window: 30 days back to 60 days ahead (WIB); at most 366 days. Yahoo reports actions only after the ex-date, so upcoming dates are usually empty. `400` on bad dates |
| `GET /v1/news?page=&page_size=&symbol=` | API token | Headlines newest first (`newsItemSchema`): `date` (WIB ISO), `title`, `summary`, `url`, plus `outlet`, `symbols`, `dateEstimated`. `page_size` 1–100 (default 20). `meta.freshness` is `DELAYED` while the newest headline is under a day old, then `STALE` |
| `GET /v1/macro` | API token | BI-Rate and JISDOR (`macroSchema`): latest value and date, the previous one, the press-release link (BI-Rate), and up to 10 observations newest first. `meta.dataAsOf` is the newest date |
| `GET /v1/insiders/recent?days=&action=&limit=` | API token | Market-wide insider feed (`insidersRecentSchema`): transactions dated within the last `days` (1–30, default 7; `from`–`to` WIB), optionally `action` `buy`/`sell`/`cross`, newest first then largest value, at most `limit` (1–200, default 50). Each row: symbol, person, roles, action, date, signed share change, shares and percent (percent units) before/after when given, price and value (\|shares\| × price; null without a price), broker, nationality, source, as-of. `coverage`: `checked` of `active` stocks read within the last `ENGINE_ARJUM_INSIDER_REVISIT_DAYS` days and the oldest such read. `meta.dataAsOf` is the newest read, `HISTORICAL`. Before the first read (feed off, the default): the empty form, `UNAVAILABLE`. `400` on bad parameters |
| `GET /v1/announcements` | API token | Always the empty `UNAVAILABLE` form: IDX disclosures are only on `www.idx.co.id`, which blocks the engine (Cloudflare 403, §5.4). `/v1/meta/health` lists it under `unavailable` with the reason |
| `GET /v1/strategies` | API token | The latest scan of the current rules version as a HAKA-18 board (`strategyBoardSchema` from `src/lib/strategies/contract.ts`): `contexts` (version, universe covered/eligible/skipped), `strategies` (`breakout`, `bb-reversal`; `HAKAPRO_EOD_ENGINE`, `EOD`) and `candidates` (score null, `criterion`/`note` reasons, metrics with units). `meta.dataAsOf` is the session date; freshness `EOD`, then `STALE`. Flag off, or no scan yet: the empty board, `UNAVAILABLE` |
| `GET /v1/stocks/{s}/fundamentals` | API token | `fundamentalsSchema`: one entry per (period end, `ANNUAL`/`QUARTERLY`), newest first; `metrics` as stored, plus `units` per metric (`IDR`, `USD`, `IDR/share`, `shares`), `currency` and `source`. `meta.dataAsOf` = the newest period end, `HISTORICAL`. Empty `UNAVAILABLE` form without statements |
| `POST /v1/screener` | API token | `screenRequestSchema` (≤ 20 conditions, `limit` 1–1000, default 500) over every stock with a row in the newest session: `price`, `volume`, `value`, `frequency`, `foreignNetShares` (buy − sell shares), `marketCap` (close × listed shares, else the universe snapshot), `per`, `pbv`, `roe`, `roa`, `eps`, `der`, `dividendYield`, `change1D` (fraction; the app converts its percent). AND binds tighter than OR; a null value never matches. Rows most traded first; `total` counts all matches; `supportedFields` lists only fields with a value in the session; `ratioSources` names `derived`/`pasardana` per symbol and ratio. Missing values are null, never 0. `400` on an invalid request |
| `GET /v1/stocks/{s}/profile` | API token | `404 NO_DATA` (no source) |
| `GET /v1/stocks/{s}/ownership` | API token | E6: the symbol's newest uploaded ≥1% month (`stockOwnershipSchema` in `src/server/schemas/ownership.ts`): each disclosed line verbatim (holder key, name, kind, shares, percent, investor type, local/foreign, line reference), the position date, threshold, source (dataset, the owner's label, retrieval time, upload id) and the comparison with the previous month. `freeFloat` is `null` unless `ENGINE_FREE_FLOAT_ENABLED=1`. `HISTORICAL`, dated by the position date; the empty form (`UNAVAILABLE`) when nothing is stored |
| `GET /v1/ownership/changes?month=YYYY-MM[&symbol=]` | API token | E6: per-holder changes into `month` from the previous month (`ownershipChangesSchema`): `NEW` / `INCREASE` / `DECREASE` / `UNCHANGED` / `BELOW_THRESHOLD` / `EXIT` / `AMBIGUOUS` with exact share and percentage-point deltas, flags and the line references of both months, plus each issuer's comparison status (`COMPARED`, `NO_PREVIOUS`, `NOT_ADJACENT`). `month` is required (`400` otherwise) |
| `POST /v1/admin/jobs/{id}/run`, `/v1/admin/pause`, `/v1/admin/resume`, `/v1/admin/sources/{id}/unblock` | `ENGINE_ADMIN_TOKEN` | Return 404 when the admin token is unset |
| `POST /v1/admin/ownership/upload`, `GET /v1/admin/ownership/uploads`, `POST /v1/admin/ownership/uploads/{id}/reparse` | `ENGINE_ADMIN_TOKEN` | E6 uploads, see [Ownership uploads](#ownership-uploads-e6) |

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
| `ENGINE_ARJUM_INSIDER_BUDGET` | `0` | Max arjum calls per WIB day for the market-wide insider feed. `0` leaves `insider-feed` unregistered. When above 0, `ENGINE_ARJUM_DAILY_BUDGET + ENGINE_ARJUM_INSIDER_BUDGET` must be ≤ `1000 − ENGINE_ARJUM_RESERVE` or the engine refuses to start: each insider call is taken from foreign-flow coverage or the app's reserve (see "arjum quota") |
| `ENGINE_ARJUM_INSIDER_REVISIT_DAYS` | `7` | A symbol's insider page is re-read at most once per this many days (1–90); also the window `/v1/insiders/recent` measures coverage over |
| `ENGINE_ARJUM_EOD_ENABLED` | `false` | Also treats arjum history as primary EOD OHLCV/value/frequency and records its per-session coverage. Enable only when the provider plan/terms permit server-side storage and display in HAKAPRO. The configured daily budget/reserve still applies; sessions below full active-universe coverage remain `PARTIAL` or `STALE`, and this endpoint does not provide the long backfill used by Yahoo |
| `ENGINE_STRATEGY_SCANS_ENABLED` | `false` | `true`/`1` registers `strategy-scan-eod` and serves `/v1/strategies`. Leave off until the owner approves the HAKA-17 rules |
| `ENGINE_SCHEDULER_ENABLED` | `true` | `false` serves the API only |
| `ENGINE_MIGRATE_ON_START` | `true` | Applies `db/migrations` at boot |
| `ENGINE_RAW_S3_ENDPOINT` | unset | R2: `https://6b331bf8590ae2dd7de440acdb2deeb5.r2.cloudflarestorage.com` |
| `ENGINE_RAW_S3_BUCKET` | unset | `hakapro-engine-raw` |
| `ENGINE_RAW_S3_ACCESS_KEY_ID` / `ENGINE_RAW_S3_SECRET_ACCESS_KEY` | unset | Bucket-scoped R2 token (Object Read & Write) |
| `ENGINE_RAW_S3_REGION` | `auto` | |
| `ENGINE_OWNERSHIP_MAX_UPLOAD_MB` | `20` | Largest ownership upload (1–100); larger bodies get `413` |
| `ENGINE_FREE_FLOAT_ENABLED` | `false` | `1`/`true` serves the HAKA-34 estimate (`methodologyStatus: "draft"`) on `/v1/stocks/{s}/ownership`. Leave it off until the owner approves FREE-FLOAT-METHODOLOGY.md; the estimate is computed and stored either way |

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

Running `universe`, `eod-daily`, `intraday`, `news`, `fundamentals` or the `macro-*` jobs locally calls the real sources (honest UA, rate-limited). Keep `ENGINE_SCHEDULER_ENABLED=false` unless you mean to crawl, and trigger single jobs by hand.

Scripts (repo root):

| Script | What it does |
| --- | --- |
| `engine:dev` / `engine:start` | Run the engine |
| `engine:typecheck` | Also run by `bun run typecheck` |
| `engine:db:generate` | `drizzle-kit generate` from `db/schema.ts` |
| `engine:db:migrate` | Apply the migrations |
| `engine:test:e2e` | Docker PostgreSQL + the fixture world: every job, block/fallback paths, news (conditional GET, dedupe, per-outlet blocks, retention), macro, fundamentals (order, spacing, weekly and catch-up cycles, a 429 resting both Yahoo sources, the cooldown lifting and escalating) → ratios → `/v1` fundamentals and screener, universe → EOD → foreign → intraday → `/v1`, and ownership uploads (two synthetic months, dedupe, a corrected XLSX re-upload, re-parse, failure, size limit), and the strategy scan on a synthetic universe (flag off/on, `SKIPPED` → `SUCCEEDED`, schedule vs manual re-run, `/v1/strategies`); not part of `bun run test` or CI |

Unit tests run with the root `bun run test` (parsers, fetcher, scheduler, `/v1` derivations and routes).

### Fixtures

`test/fixtures/` holds trimmed real responses for the parsers, recorded on 2026-10-16 between 11:29 and 11:40 WIB with 8 requests in total (honest UA, at least 2 s apart per host, no block seen): TradingView `indonesia/scan` (5 rows) and `global/scan` (two calls: the confirmed index list), Pasardana `GetAll` (3 rows, plus one call that confirmed 1-based paging), and Yahoo chart for `BBCA.JK` (5d, and 2021 events trimmed to 5 bars) and `^JKSE` (5d). The E3 fixtures were recorded on 2026-10-16 between 14:27 and 14:28 WIB with 7 requests (one per URL, honest UA, no retries, at least 6 s apart and never two in a row to one host, no block seen): the five news feeds trimmed to 3 items each (`news-*.xml`) and the BI-Rate and JISDOR pages trimmed to the table with 3 rows (`bi-rate.html`, `bi-jisdor.html`; the BI-Rate one keeps its commented-out `BI-7 Day` column). The E5 fixtures were recorded on 2026-10-16 between 15:24 and 15:25 WIB with 3 requests (Yahoo fundamentals timeseries for BBCA, TLKM and GOTO, at least 15 s apart, honest UA, no retries, all 200, no block), trimmed to 13–15 of the 26 lines each (`yahoo-fundamentals-*.json`). `arjum-history-BBCA.fake.json` is invented data in the shape of `fixtures/arjum`; arjum was not called. `test/source-fixtures.ts` serves them at the real paths and refuses every other URL, so no test touches the network.

The image build uses `services/engine/package.json` and `bun.lock` only. Local development uses the root install. After changing a runtime dependency version at the root, mirror it there and run `bun install --lockfile-only` in `services/engine`.

## Ownership uploads (E6)

The KSEI ≥1% shareholder list is published monthly as a PDF in an IDX announcement ("Pemegang Saham di atas 1% (KSEI)"). idx.co.id and KSEI block the engine (DATA-ENGINE.md §5.9), so the owner downloads the file by hand and uploads it (§8.5d). The engine never fetches it. The data is for internal use only: it needs written permission from IDX/KSEI before a public or paid HAKAPRO (CONNECTION-NETWORK.md → "Data Engine inputs").

**Network: the engine has no public domain.** It listens on port 8080 inside the Coolify private network only, so an upload has to come from inside that network, or through an admin-only domain or tunnel set up later. Which route to use is the owner's decision; nothing here adds a public domain. Options on the Coolify server today:

- From the host shell: the engine container's IP (`docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}' <engine container>`) on port 8080.
- From a throwaway container on the engine's Docker network, where the container name resolves: `docker run --rm --network <network> -v "$PWD":/f curlimages/curl:8.10.1 …` with `@/f/<file>`. (The engine image has no curl, so `docker exec` into it doesn't help.)

### Uploading a month

1. Download the month's PDF from the IDX announcement in a browser.
2. Copy it to the Coolify server (e.g. `scp`), then upload it with the admin token. `asOf` is the month the list is for, `source` is your label for where it came from (the announcement number is ideal):

```sh
ENGINE=http://<engine-ip-or-name>:8080     # private network address; see above
TOKEN='<ENGINE_ADMIN_TOKEN>'               # placeholder: the value from Coolify's env vars

# Raw body (PDF; CSV with -H 'content-type: text/csv'; XLSX with the spreadsheet content type)
curl -sS -X POST "$ENGINE/v1/admin/ownership/upload?asOf=2026-02&source=IDX%20Pengumuman%20Peng-00000%2FBEI%2F03-2026&filename=ksei-1pct-2026-02.pdf" \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/pdf' --data-binary @ksei-1pct-2026-02.pdf

# Or multipart (the parameters may be form fields)
curl -sS -X POST "$ENGINE/v1/admin/ownership/upload" -H "authorization: Bearer $TOKEN" \
  -F asOf=2026-02 -F 'source=IDX Pengumuman Peng-00000/BEI/03-2026' -F file=@ksei-1pct-2026-02.pdf

# What happened to every upload (status, row errors, counts), newest first
curl -sS "$ENGINE/v1/admin/ownership/uploads?limit=10" -H "authorization: Bearer $TOKEN"
```

Parameters: `asOf=YYYY-MM` (required; not in the future), `source` (optional, ≤ 200 characters), `snapshotDate=YYYY-MM-DD` (optional; the position date when the file has no DATE column or title date; must be inside `asOf`), `filename` (optional label for raw bodies). The file may be at most `ENGINE_OWNERSHIP_MAX_UPLOAD_MB` (20 MB). Accepted: PDF with a text layer (not a scan), XLSX (first sheet), CSV (UTF-8, comma or semicolon).

Responses: `201` parsed; `422 PARSE_FAILED` with the stored upload, its `error` and row `issues`; `200` with `duplicate: true` for the same bytes again (sha256); `409` when the same file was already uploaded for another month; `413` too large; `415` not a PDF/XLSX/CSV; `400` bad parameters; `503 DISK_GUARD` while the disk guard trips; `401` without the token (`404` when `ENGINE_ADMIN_TOKEN` is unset).

What the engine does with an upload:

- Stores the original in the raw store (`ownership-upload/<date>/<sha256>.<ext>`, indexed in `raw_documents` under the source `ownership-upload`, which `/v1/meta/health` lists) and records an `ownership_uploads` row (`RECEIVED` → `PARSED` or `FAILED`).
- Parses the table into one snapshot set per issuer (`ownership_snapshot_sets` + `ownership_snapshot_rows`): ticker, holder name as published, holder kind (`person`, `organisation`, `custodian_nominee`, `government`, `public`, `unknown`, from the stated investor type and the existing name rules), holder key (HAKA-33 policy), shares, percent, investor type and local/foreign as stated, and a line reference (`upload:<id>#p3.l12` = page 3, line 12; `#r12` for spreadsheet rows). Columns the engine doesn't use (nationality, domicile, addresses, any identifier) are dropped at parsing. A row with a bad value is skipped and listed in `issues` with its locator; the rest of the file still loads. The upload fails only when the file has no header, no position date, a position date outside `asOf`, or no valid row.
- Replaces each issuer's set for that month (a corrected re-upload of the month wins; issuers missing from it keep their earlier set). Lines the list prints twice are kept twice.
- Compares each issuer with the previous month when that month is stored (`compareOwnershipSnapshots`, adjacent months only; otherwise `NOT_ADJACENT`, no changes) and stores the per-holder changes (`ownership_changes`, derivation `haka33-compare@1`). Uploading an earlier month later re-derives the month after it. Holders missing from the later list are `BELOW_THRESHOLD`, never `EXIT`.
- Computes the HAKA-34 free-float estimate per issuer (`estimateFreeFloat`, investor types as the only signal) and stores it with `methodologyStatus: "draft"`. It is not served unless `ENGINE_FREE_FLOAT_ENABLED=1`, and it is never an official figure.

**Re-parse** after a layout fix, without uploading again: `curl -sS -X POST "$ENGINE/v1/admin/ownership/uploads/<id>/reparse" -H "authorization: Bearer $TOKEN"`. It reads the raw copy, replaces that upload's sets and changes, and records the result on the same upload. A failed re-parse withdraws the upload's sets.

### When the first real PDF arrives

No real ≥1% PDF has been read yet; the parser was designed against the columns CONNECTION-NETWORK.md §1.3 documents and tested on a synthetic PDF in that layout. Upload the first real month, then check `GET /v1/admin/ownership/uploads`: `stats.columns` shows which header labels were found and the field each mapped to (`null` = unused), `stats.rowsAccepted/rowsRejected` and `issues` show what didn't fit. Adjust only `src/ownership/layout.ts`, then re-parse:

1. `HEADER_ALIASES`: add the PDF's exact header labels (upper case, whitespace collapsed) for any column mapped to `null` that should be read.
2. `PDF_LAYOUT`: `minHeaderMatches`; `headerMergeLineHeights` (two-line headers); `continuation` (`"previous"` when wrapped names continue below their row, `"next"` when the row's values print on the last line); `continuationMaxPitch`.
3. `IGNORED_LINE_PATTERNS` for page headers, footers or totals reported as "line is not a table row".
4. `holderKindFor` in `src/ownership/normalize.ts` if the file uses other investor-type codes.

Bump `OWNERSHIP_PARSER_VERSION` in `src/ownership/parse.ts` with any layout change. If the PDF can't be made to parse (a scan, merged cells), export the table to CSV/XLSX with the same headers and upload that instead.

Fixtures: `test/fixtures/ownership/` holds **synthetic** files only (tickers `TEST1`–`TEST4`, invented holders such as `PT CONTOH DUMMY TBK`), generated by `bun services/engine/test/fixtures/ownership/generate.ts` from `test/ownership-fixtures.ts` (a unit test checks they match). The PDFs are written by the tiny `test/pdf-writer.ts`; no real list was downloaded or copied.

PDF text extraction uses [`unpdf`](https://github.com/unjs/unpdf) (the serverless pdf.js build: pure JavaScript, no native dependency, no worker); XLSX reading uses `fflate` for the zip container. Both are bundled into `main.js` at image build. The first PDF parse after a start takes a few seconds while pdf.js loads.

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
  - optionally `ENGINE_OWNERSHIP_MAX_UPLOAD_MB`; leave `ENGINE_FREE_FLOAT_ENABLED` unset until the methodology is approved
- **Consumers:** develop, staging and production set `MARKET_API_URL` to the engine's private-network URL (for example `http://hakapro-engine:8080`). Point develop at it first, once the first universe and EOD runs have filled the tables (`/v1/meta/health` shows the sources `OK` and the session `COMPLETE` or `PARTIAL`); routes without data still answer with empty `UNAVAILABLE` envelopes or `404 NO_DATA`.
- **Builds:** pause crawling around deployments with `POST /v1/admin/pause`, then `/resume`. Coolify concurrent builds are already 1.
- **Startup:** the engine waits up to 60 s for PostgreSQL, then exits non-zero, and Coolify's restart policy brings it back. If the DB hostname does not resolve at boot, Bun caches the failed lookup for the life of the process, so a restart is the recovery path.
