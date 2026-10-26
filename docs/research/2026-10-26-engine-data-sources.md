# Data Engine: additional data sources, legitimacy and ranking

Date: 2026-10-26. Scope: which further market data the HAKAPRO Data Engine could collect and serve, with terms and rights checked. This is research only: no engine code was written, no provider was contacted, nothing was signed up for, and no crawler was run. It is a source and terms review, not legal advice.

Builds on, and does not repeat: `docs/features/DATA-ENGINE.md` (sources §5, conduct §2), `docs/research/2026-10-21-indonesia-public-market-data-crawling.md` and `services/engine/README.md`. Already settled there: idx.co.id and KSEI blocked, Yahoo refused from the engine IP, TradingView scanner and Pasardana experimental, arjum 1000/day quota, BI JISDOR/BI-Rate, four news RSS feeds. The Yahoo production-block note named in the task is not on `origin/develop` (the related change is the branch `fix/yahoo-rate-limit-cooldown`), so it was not read.

**Method and honesty notes.** Every pricing or quota figure below was read on 2026-10-26 from the cited page; pages change without notice. Pages were read through a summarising fetch tool, so numbers are as the tool reported them; where a page was contradictory or unreadable it is marked "unverified". Nothing was tested with a vendor API key, so **no vendor's real IDX field coverage, adjustment behaviour or latency is verified**, only what its documentation or pricing page says. Items I could not read at all are listed as such.

---

## (a) Executive summary

### The finding that matters most

There is still **no free, rights-clean, full-market EOD source** for IDX. Every route to per-stock daily OHLCV for ~960 stocks is one of:

1. **IDX's own licensed products** (rights-clean, price and contract overhead; the only route that clearly allows redistribution);
2. **a commercial vendor** that lists `.JK` (cheap, but the vendor's terms for a company's public/paid app are unverified, and several explicitly limit plans to personal use);
3. **operator-supplied data** (a human or a separately run collector pushes files), which does not change what the source's terms allow.

IDX Data Services publishes a 2026 price list. Equity EoD (OHLCV, value, frequency, **foreign buy/sell in the Recapitulation product**) is sold direct (needs a leased line via a network service provider) or **indirectly through a licensed redistributor**: Antara (LKBN), IQ Plus, **RTI Infokom**, IDX-STI locally; Bloomberg, Refinitiv, ICE, FactSet, SIX abroad. The catalogue lists "Fintech Startup" and "Financial Application Developer" as target customers. A one-month free trial and a 300% security deposit apply. See §b rows 1-3.

### Ranked recommendation: top 5 to build next

Ranking is (value to a retail trader) x (legitimacy) x (effort). Item 0 is a business action, not code, and should start in parallel because it is the only thing that unblocks a public launch.

| Rank | Build | Effort | Legitimacy | Unblocks |
| --- | --- | --- | --- | --- |
| 0 (parallel, no code) | **Ask for an IDX EoD quote via a redistributor (RTI / IQ Plus / Antara / IDX-STI) and IDX directly**, using the checklist in (d) | 1-2 days of emails, then weeks of contracting | High (rights-clean) | EOD OHLC, foreign buy/sell, history, corporate actions (Data Reference), production launch |
| 1 | **Open macro and commodity adapters**: World Bank Pink Sheet monthly XLSX (CC BY 4.0) plus IMF monthly commodity XLSX; BPS WebAPI once a key is registered; FRED only with its required notice | S (2-3 days) | High for World Bank; Medium for IMF (terms not read), BPS (commercial use needs approval), FRED (per-series third-party rights) | macro and commodity cards (coal, CPO, nickel, gold, rates); `macro_observations` |
| 2 | **OJK press-release list adapter** (HTML list of "Siaran Pers", headline + link + date only) | S (1-2 days) | Medium (terms silent on automated access; no robots.txt found; quoting allowed with full source) | regulatory/market news, partial replacement for blocked disclosures; `news_items` |
| 3 | **Vendor EOD adapter, provider-neutral, behind a flag and off by default** (first target EODHD; Twelve Data as the alternative), using one bulk "last day" call per exchange plus per-symbol history/splits/dividends | M (4-6 days) | Medium-Low until the vendor agrees business/redistribution terms in writing | EOD OHLC, history backfill (2020+), corporate actions (splits, dividends), optional fundamentals |
| 4 | **Index Alpha foreign-flow / broker-summary batch adapter** (1-50 tickers per call, history from 2025-01-01) | S (2-3 days) | Medium (commercial API; terms page not found; OHLCV option is Yahoo-sourced) | foreign flow beyond the arjum cap, broker summary |
| 5 | **Operator push endpoint** (`POST /v1/admin/eod/ingest`, admin token, same pattern as ownership upload) accepting CSV/JSON of licensed or operator-collected EOD rows | M (3-4 days) | Depends entirely on the data's own terms; the endpoint itself is neutral | EOD OHLC from licensed file deliveries, one-off history purchases (e.g. TICMI), a home-IP collector |

Corporate actions, fundamentals and ownership have **no free, permitted, machine-readable route** beyond what the engine already does (Yahoo events, Yahoo fundamentals, manual KSEI upload). The paid routes are IDX Data Reference (financial statements, corporate actions, suspensions) and vendor fundamentals; see §b.

### If only one EOD source could be chosen

**For an internal, experimental engine today: EODHD (All-World/Historian plan, USD 19.99/month).** It is the cheapest vendor I could find that publicly lists the Jakarta exchange (MIC XIDX, 924-962 active `.JK` tickers on its exchange page), prices EOD calls at 1 credit regardless of history length, offers 100,000 calls/day on paid plans, and has an exchange-wide bulk end-of-day endpoint (one call per day instead of ~960). **But**: its terms put any use inside a business in the "professional" category and sell non-professional plans for personal investing only, so HAKAPRO would need a professional/commercial agreement in writing, and I could not confirm that IDX EOD is included in the cheapest plan (its exchange page says downloads of that listing need "All World Extended" or higher; unclear whether that refers to the EOD price data or only to holidays/hours). **For a public or paid HAKAPRO, the only choice I would stand behind is the IDX EoD licence through a redistributor**, because it is the only route that explicitly addresses display and redistribution rights. If forced to a single name for the whole roadmap: the licensed IDX Equity EoD (Professional + Recapitulation), via a redistributor.

### Reachability probes (engine server network, 2026-10-26)

Twelve hosts, **one GET per host**, honest user agent `HAKAPRO-DataEngine/0.1 (+https://hakapro.heulaulab.xyz)`, redirects not followed, through a temporary disabled Coolify scheduled task (created, executed with confirm, read, **deleted**). No 403, 429 or challenge occurred, so nothing was recorded as blocked. Reachable means the landing page answered, not that API use is permitted.

| Host (path) | Result | `server` header |
| --- | --- | --- |
| eodhd.com `/` | 200 | nginx/1.19.10 |
| twelvedata.com `/` | 200 | cloudflare |
| indexalpha.id `/` | 200 | cloudflare |
| financialmodelingprep.com `/` | 301 (to site.financialmodelingprep.com) | nginx |
| webapi.bps.go.id `/` | 302 | (none) |
| api.worldbank.org `/` | 404 (no resource at root; host reachable) | cloudflare |
| ojk.go.id `/` | 302 | (none) |
| www.djppr.kemenkeu.go.id `/` | **TLS error `ERR_TLS_CERT_ALTNAME_INVALID`**; not retried, verification not disabled | n/a |
| www.kontan.co.id `/rss` | 200 | nginx |
| fred.stlouisfed.org `/` | 200 | Apache |
| thedocs.worldbank.org `/` | 301 | cloudflare |
| www.imf.org `/` | 404 (root path; host reachable) | (none) |

Not probed (limit of 12): idx.id, data.idx.co.id, pasardana.id (already known), Antara/CNBC/detik/investortrust (already running in the engine), sectors.app, goapi.io, marketstack.com.

---

## (b) Decision matrix

Legend. Legitimacy: **High** = terms explicitly allow the use or it is an official licence; **Medium** = commercial or public source whose terms allow some use but not clearly redistribution; **Low** = terms restrict or are unknown and prohibition is plausible. Effort: S ≤ 3 days, M 4-8 days, L > 8 days. Reachable from engine server: Y / N / not tested (see probes). "Fields" abbreviations: OHLCV = open, high, low, close, volume.

### 1. Daily OHLCV EOD, all IDX stocks and indices, plus history

| # | Source | Data | Access | Auth | Quota and cost (as of 2026-10-26) | Terms / robots verdict | Reach | Legit | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **IDX Data Services, Equity EoD, direct** ([catalogue](https://www.idx.id/en/products/idx-data-services), [2026 pricelist PDF](https://www.idx.id/media/auobyarx/idx-catalogue-pricelist-updated-2026.pdf)) | EoD Basic: previous, close, change, volume, value, freq. EoD Professional: previous/high/low/close/change/volume/value/freq/weight/best bid/offer, top foreign-bought, foreign ownership, indices. Indices, Indices Weight, Recapitulation (see row 27) | System-to-system feed over a leased line from a listed network service provider (Lintasarta, Biznet, CBN, Matrix, Fiberstar, IPC, TNSI) | Licence plus credentials | Monthly fees run from about IDR 0.4M to 11M (USD 40-2,000) by product, Main/Additional licence, group/non-group, member/local/foreign. I could not reliably map each figure to each product from the extracted PDF text; ask for the exact row. 300% security deposit, 1-month free trial ([pricelist p.38](https://www.idx.id/media/auobyarx/idx-catalogue-pricelist-updated-2026.pdf)) | Licensed product, display vs non-display licence classes (non-display has four usage categories shown only as an image); rights to redistribute must be confirmed in writing. robots n/a | not tested | High | L (contract plus leased line) |
| 2 | **IDX-i Equity EoD via a redistributor** (Antara LKBN / IMQ, IQ Plus, RTI Infokom, IDX-STI; foreign: Bloomberg, Refinitiv, ICE, FactSet, SIX) ([same pricelist, redistributor pages 30-31](https://www.idx.id/media/auobyarx/idx-catalogue-pricelist-updated-2026.pdf)) | Same product family; redistributors package delivery (API/file/terminal) on their own terms | Contact each redistributor (emails and phone are in the pricelist: e.g. sales@rti.co.id, marketing@iqplus.info, cs@imq21.com, contact@idxsti.co.id) | Redistributor contract | IDX-i fees in the pricelist run from about IDR 0.35M to 9.9M per month (USD 40-1,800), mapping unverified; the redistributor adds its own margin | Contract. Display and redistribution rights are the question to put to each | not tested | High | M (integration) after the contract |
| 3 | **IDX website EOD / Ringkasan Saham** | Full market table | HTML/JSON | none | free | **Not permitted**: IDX terms clause 6 forbid web scraping/crawling and commercial use without written consent ([terms](https://www.idx.id/en/terms-of-use)); site also returns Cloudflare 403 to the engine | N (403, DATA-ENGINE §5) | n/a | n/a |
| 4 | **EOD Historical Data (EODHD)** ([pricing](https://eodhd.com/pricing), [JK exchange page](https://eodhd.com/exchange/JK), [EOD API docs](https://eodhd.com/financial-apis/api-for-historical-data-and-volumes), [terms](https://eodhd.com/financial-apis/terms-conditions)) | `.JK` listed: 924 (page fetch) to 962 (search snippet) active tickers, MIC XIDX. Fields: date, open, high, low, close, adjusted_close, volume; OHLC raw, volume split-adjusted. Bulk "entire exchange for one date" endpoint exists (docs name it only in passing). Splits/dividends APIs exist | REST JSON/CSV, API key | Key | Free: 20 calls/day, 1 year, 500 welcome calls. Historian (EOD All-World) USD 19.99/mo (199/yr); Active trader 29.99; Equity analyst (fundamentals) 59.99; All-in-one 99.99. Paid: 100,000 calls/day, 1,000/min, 30+ years. EOD call = 1, fundamentals 10, bulk 100+ | **Non-professional use is personal only; "any use as part of a business activity" is professional; no stated redistribution/display licence** ("sales@eodhistoricaldata.com" for professional terms). Whether IDX EOD is in the Historian plan is unverified | Y (200) | Medium-Low until a professional agreement | M |
| 5 | **Twelve Data** ([pricing](https://twelvedata.com/pricing), [exchanges](https://twelvedata.com/exchanges)) | XIDX listed, **EOD delay**, minimum **Pro** individual plan, **Venture** business plan (exchanges page, price of Venture not read) | REST | Key | Basic 0 USD (800 credits/day, 8/min); Grow 79; Pro 229; Ultra 999. Plan cards and comparison table disagree on credits per minute, so unverified | Pricing page labels "internal display" / "internal non-display" per plan; **redistribution not addressed** | Y (200) | Medium-Low | M |
| 6 | **Index Alpha** ([pricing](https://indexalpha.id/id/pricing), [endpoints](https://indexalpha.id/id/docs/endpoints)) | `GET /stocks/ohlcv`, `source=idx` (as traded) or `yfinance` (adjusted); max range 366 days; IDX data documented from 2025-01-01; older "may be available on Enterprise" | REST, bearer token | Key | Free: 5 requests/day, 10/min. Starter IDR 250,000 (200,000 per 30 days): 25,000/month, 120/min. Professional IDR 450,000 (350,000): 100,000/month. Advanced IDR 950,000 (750,000): 250,000/month | No terms page found (`/id/terms` 404). The `yfinance` option is Yahoo-sourced, inheriting Yahoo's unclear rights | Y (200) | Medium | S |
| 7 | **Marketstack** ([pricing](https://marketstack.com/pricing), [FAQ](https://marketstack.com/faq)) | Page states 70 exchanges, 30,000+ tickers; **IDX not named anywhere I could read** | REST | Key | Free 100 requests/month (non-commercial, 1 year); Basic USD 9.99 (10,000/mo, 10 years, commercial: yes); Pro 49.99; Business 149.99 | Free tier non-commercial; redistribution not addressed; US data sourced from Tiingo | not tested | Low (IDX unverified) | M |
| 8 | **Financial Modeling Prep** ([host](https://site.financialmodelingprep.com/)) | Pricing page returned 403 to my fetch tool and was not retried; IDX/JK coverage **unverified** | REST | Key | unknown | unknown | Y (301) | Unknown | M |
| 9 | **Alpha Vantage, Finnhub, Polygon, Tiingo** | Searches found **no confirmation** of IDX (`.JK`) coverage. Finnhub: free plan reported US-centred and international data on paid plans (third-party summaries only). Alpha Vantage free tier reported 25 requests/day (third-party). Polygon and Tiingo were not researched beyond one search each | REST | Key | not verified | not verified | not tested | Unknown | n/a |
| 10 | **Sectors.app** ([docs](https://docs.sectors.app/)) | Indonesia and Singapore equities: financials, prices, broker flows, screeners, news; endpoint list not read | REST, `Authorization` header | Key (API only on Insider plan) | Forever Free and Standard (USD 49/mo) have **no API access**; Insider USD 59/mo, 5,000 credits/month | Docs carry no terms; sectors.app/api returned HTTP 429 to my fetch tool (not retried); redistribution unverified | not tested | Medium-Low | S-M |
| 11 | **GoAPI.io** ([site](https://goapi.io)) | Reported as an IDX data API (third-party skill listing); site pricing and endpoints not read | REST | Key | unverified | unverified | not tested | Unknown | M |
| 12 | **Pasardana (already in engine)** ([terms](https://pasardana.id/term-of-use)) | Snapshot with value/frequency/ratios | JSON | none | free | Content incl. data belongs to PT Bina Investama Infonet; **copying, redistributing or rebroadcasting needs BII's written permission**. Raises the rights bar for the existing experimental source | Y (DATA-ENGINE §5) | Low for public use | n/a |
| 13 | **TICMI** (IDX/KPEI/KSEI subsidiary) | Per IDX terms clause 2: listed-company data older than 3 years is available through TICMI; a library page describes data back to 1977 (financials, trading, corporate actions) | Subscription | Account | unknown | Own terms, not reviewed | not tested | Medium | Unknown |
| 14 | **Investing.com, Stockbit/Ajaib partner APIs, Bloomberg B-PIPE, RTI terminal** | Investing.com and Stockbit/Ajaib have no public documented market-data API I could find; B-PIPE is out of scope; RTI is reachable as an IDX redistributor (row 2) | n/a | n/a | n/a | not reviewed | not tested | n/a | n/a |
| 15 | **Operator-run collector from a static home/office IP pushing to an authenticated engine endpoint** | Whatever the underlying source terms allow | Engine admin endpoint (new; pattern in `src/ownership/` upload) | `ENGINE_ADMIN_TOKEN` | free | **Changes nothing about rights**: IDX terms forbid crawling from any address; Yahoo has no public API terms; a 429 is a rate limit (DATA-ENGINE §2). Acceptable only for a source whose terms allow collection, from one fixed address, honest user agent, same per-host limits, stop on 429/403. Never use it to get round a refusal | n/a | Depends on source | M |

### 2. Corporate actions, dividends, splits, rights, listing/delisting, suspensions/UMA

| # | Source | Data | Access | Quota and cost | Terms verdict | Reach | Legit | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 16 | **IDX Data Reference for Enterprise** ([catalogue](https://www.idx.id/en/products/idx-data-services)) | Financial statements, **corporate actions**, routine reports, material information disclosures, **suspension/unsuspension reports**, 800+ listed companies | System feed, direct or indirect | Monthly IDR 4.5M-20M (USD 450-2,000) by licence type (pricelist p.24, mapping approximate) | Licensed product | not tested | High | L |
| 17 | **Yahoo events (already used)** | Ex-dates and amounts only, no record/payment dates, no rights or warrants | JSON | free | No public terms; IP refused (429) | N | Low | n/a |
| 18 | **EODHD splits/dividends API** | Splits and dividends with dates and ratios | REST | included in plans above | as row 4 | Y | Medium-Low | S once row 4 exists |
| 19 | **OJK press releases** ([list](https://www.ojk.go.id/id/berita-dan-kegiatan/siaran-pers/Default.aspx)) | Headlines, dates, links; occasional capital-market rules, not per-issuer actions | HTML list, 10 pages; **no RSS found** | free | [Terms](https://www.ojk.go.id/id/Pages/syarat-dan-kondisi.aspx): quoting allowed "dengan menyebutkan sumbernya secara lengkap"; silent on crawling and commercial use. `ojk.go.id/robots.txt` returned 404 (no robots file found) | Y (302 on root) | Medium | S |
| 20 | **Issuer IR pages, KSEI notices, IDX announcements** | Per-issuer dividend, rights, RUPS | HTML/PDF | free | IDX blocked; KSEI blocked; issuer sites each have their own terms and layouts (not reviewed, high maintenance) | N | Low | L |

### 3. Financial statements and ratios

| # | Source | Data | Access | Cost | Terms verdict | Reach | Legit | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 21 | **IDX XBRL / reports** | Standardised statements | blocked host | n/a | IDX terms bar crawling; Cloudflare 403 | N | n/a | n/a |
| 22 | **IDX Data Reference** | see row 16 | | | | | High | L |
| 23 | **EODHD fundamentals** (Equity analyst USD 59.99/mo; fundamentals call = 10 credits; non-US statements from 2000 per pricing FAQ) | Statements, ratios | REST | as row 4 | as row 4; IDX fundamentals coverage unverified | Y | Medium-Low | M |
| 24 | **Sectors.app** (row 10) | Indonesian financials | REST | USD 59/mo | unverified | not tested | Medium-Low | M |
| 25 | **Yahoo fundamentals timeseries (already used)** | ~4 annual and ~5 quarterly periods | JSON | free | IP refused | N | Low | n/a |
| 26 | **Issuer annual-report PDFs** | Everything, unstructured | PDF | free | per issuer | n/a | Low | L |

### 4. Foreign flow, broker summary, net buy/sell, order book

| # | Source | Data | Access | Cost | Terms verdict | Reach | Legit | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 27 | **IDX EoD Recapitulation** | Foreign and domestic buy/sell volume and value, market-wide | licensed feed | Monthly IDR 0.4M-4M together with Indices Weight (mapping unverified) | Licensed | not tested | High | M |
| 28 | **Index Alpha `/foreign-flow` and `/stocks/broker-summary`, plus `/batch`** (1-50 tickers per call; each ticker counts as one usage entry) | Foreign buy/sell/net; broker activity, RG/NG/ALL market, investor all/f/d; from 2025-01-01 | REST | See row 6; a batch of 50 is **50 quota units**, so the free 5/day covers 5 tickers | No terms page found | Y | Medium | S |
| 29 | **arjum (already used)** | per stock | REST | 1000/day shared | existing entitlement question | n/a | Medium | n/a |
| 30 | **ITCH / order book** | Total View etc. | IDX direct, expensive | Pricelist | Licensed | not tested | High | L (not suited to this engine) |

### 5. Macro and cross-asset

| # | Source | Data | Access | Auth | Terms verdict | Reach | Legit | Effort |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 31 | **World Bank Commodity Price Data ("Pink Sheet")** ([page](https://www.worldbank.org/en/research/commodity-markets)) | Monthly commodity prices; the XLSX is `CMO-Historical-Data-Monthly.xlsx` on thedocs.worldbank.org; page shows "October 2026" release and next update **2026-11-03**. Series list (coal, palm oil, nickel, gold) **not confirmed**; open the file to verify | XLSX download, no CSV | none | World Bank datasets are CC BY 4.0, commercial use allowed with attribution, with dataset-level exceptions ([summary terms](https://data.worldbank.org/summary-terms-of-use)). The separate "APIs" clause limits the *API* to non-commercial use, so download the file, do not use the API | Y (thedocs 301, api 404 at root) | High | S |
| 32 | **IMF Primary Commodity Prices** ([page](https://www.imf.org/en/Research/commodity-prices)) | Monthly XLSX (`external-data.xlsx`), "updated monthly", series list not confirmed | XLSX | none | Terms not found in what I read | Y (404 at root only) | Medium (unverified) | S |
| 33 | **BPS WebAPI** ([developer page](https://webapi.bps.go.id/developer/)) | Static and dynamic tables, publications (indicators not confirmed on the page) | REST | **Free key, BPS reviews each registration** | Free for compliant use; attribution required ("This service uses the BPS API"); **commercial use needs BPS approval or a cooperation agreement**; rate limits unpublished; evading limits with multiple tokens/IPs is prohibited; no named licence, data reuse follows per-dataset policy | Y (302) | Medium | S |
| 34 | **FRED API** ([overview](https://fred.stlouisfed.org/docs/api/fred/overview.html), [terms](https://fred.stlouisfed.org/docs/api/terms_of_use.html)) | Global rates, indices, commodity series | REST JSON | Key (free-registration detail not on the pages I read) | Must display "This product uses the FRED® API but is not endorsed or certified by the Federal Reserve Bank of St. Louis"; third-party-copyrighted series need the owner's permission (check each series); on termination delete copies | Y (200) | Medium | S |
| 35 | **Bank Indonesia JISDOR and BI-Rate (already used)** | USD/IDR reference and policy rate | HTML tables | none | BI web-service documentation exists ([`getSubKursLokal4`](https://www.bi.go.id/biwebservice/wskursbi.asmx?op=getSubKursLokal4)); no reuse terms found (`robots.txt` connection reset, terms path 404, footer "©2026 Bank Indonesia") | Y (in use) | Medium | n/a |
| 36 | **DJPPR / Kemenkeu SBN yields** | Government bond yields and auctions | website | none | Host presents a **TLS certificate that does not match `www.djppr.kemenkeu.go.id`**; I did not bypass verification. Terms, format and download URLs not reviewed | **N (TLS)** | Unknown | M |
| 37 | **IBPA (bond pricing agency) yield curves** | Official INDOGB curve | subscription | | Not found publicly in one search | not tested | Unknown | n/a |
| 38 | **OJK Portal Data SJK** | Aggregate capital-market stats | portal | none | already reviewed 2026-10-21; terms silent on automated reads | not tested | Medium | M |

### 6. News and disclosure text

| # | Source | Feed | Terms verdict | Reach | Legit | Effort |
| --- | --- | --- | --- | --- | --- | --- |
| 39 | **CNBC Indonesia** `…/market/rss` (in use) | RSS | `robots.txt`: `User-agent: *  Allow: /` (Googlebot group has query-string disallows) ([robots](https://www.cnbcindonesia.com/robots.txt)). Site terms not read | Y (in use) | Medium | n/a |
| 40 | **Antara** `…/rss/ekonomi-bursa.xml`, plus `ekonomi.xml`, `ekonomi-finansial.xml`, `ekonomi-bisnis.xml` ([feed list](https://www.antaranews.com/rss)) | RSS | `robots.txt`: `*` blocks only `/ajax/*` and `/ucnews/*`; ClaudeBot blocked. **Terms: content is the property of ANTARA; sharing allowed only for personal, non-commercial purposes; reproduction or distribution needs written permission** ([terms](https://www.antaranews.com/ketentuan-penggunaan)). Silent on RSS. **Flag: the engine's existing use is fine for internal research, but a public or paid HAKAPRO needs written permission** | Y (in use) | Low-Medium | n/a |
| 41 | **Kontan** RSS ([page](https://www.kontan.co.id/rss)) | RSS (headline + teaser); the page's feed list rendered empty to my tool, and the guessed `/rss/investasi` is a 404, so the **feed URLs are unverified** | **"untuk keperluan individu dan website/blog non-komersial"**; Kontan reserves the right to prohibit modification and distribution; free | Y (200 on /rss) | Low for a paid product; Medium for a free non-commercial one | S |
| 42 | **Bisnis.com** | `https://www.bisnis.com/rss` returned 403 to my fetch tool; feed existence, terms and reachability **not verified**. Not probed from the engine, not retried | n/a | not tested | Unknown | n/a |
| 43 | **Emitennews** | `robots.txt`: `User-agent: *  Disallow: /webtools/*`, sitemap only; **no RSS found** | Terms not read | not tested | Unknown | S (sitemap-based, not RSS) |
| 44 | **detik finance, InvestorTrust (in use)** | RSS | Terms not re-reviewed here | Y (in use) | Medium | n/a |
| 45 | **OJK press releases** | HTML list, see row 19 | see row 19 | Y | Medium | S |
| 46 | **Index Alpha `/news`** | Aggregates Indonesian market news RSS, 30-second cache | Not useful: duplicates the engine's own RSS use | Y | n/a | n/a |

Update rates: CNBC/detik/InvestorTrust measured at minutes, Antara hours (DATA-ENGINE §5.7). OJK posts a few releases per week (the list shows entries from 15 to 24 October 2026).

### 7. Ownership / KSEI ≥1%

| # | Source | Verdict |
| --- | --- | --- |
| 47 | **KSEI/IDX monthly list** | Blocked (DATA-ENGINE §5.0); manual upload (E6) remains the only compliant route. Commercial reuse needs written permission. |
| 48 | **Vendor holdings data** (EODHD fundamentals "Holders" blocks, Sectors.app) | Not verified for IDX; if present it would still be a vendor's licensed view, not KSEI's list. Ask in the checklist. |
| 49 | **Operator upload of vendor/terminal exports** | Same pattern as row 15; terms per source. |

### 8. Alternative signals (low priority)

| # | Source | Verdict |
| --- | --- | --- |
| 50 | **IDX short-sell and margin lists, MSCI/FTSE constituent notices** | Published on idx.co.id (blocked) or index-provider sites (not researched). MSCI/FTSE announcements are public press material but their reuse terms were **not reviewed**. No candidate verified. |
| 51 | **ETF holdings** (IDX-listed ETFs) | Issuer fact sheets (PDF); not researched. |

---

## (c) Rejected / not possible

| Source | Reason |
| --- | --- |
| IDX website, `data.idx.co.id` self-service pages, Ringkasan Saham | Terms clause 6 forbid scraping/crawling and commercial use without consent; Cloudflare 403 from the engine IP. A source that needs Cloudflare solving is "not possible". |
| KSEI web/bulk files | Placeholder body on `www`, TCP timeout on `web`, 404 on bulk path (DATA-ENGINE §5.0). |
| Headless-browser scraping of Pasardana, Stockbit, Ajaib, RTI web, Investing.com, TradingView pages | Would require browser fingerprints or sessions; Pasardana terms also require written permission to copy or redistribute. |
| Rotating IPs, proxies or a residential address to get past the Yahoo refusal | Evasion. A different fixed collector address is only discussed in §b row 15, for sources whose terms allow collection. |
| Bloomberg B-PIPE | Out of scope (cost, terminal contract). |
| Any login-only or paywalled area (Bisnis Pro, vendor terminals) | Project conduct. |
| FMP, Alpha Vantage, Finnhub, Polygon, Tiingo, Marketstack as an IDX EOD source **today** | No evidence of IDX coverage found; revisit only if a vendor documents `.JK` or XIDX coverage. |
| DJPPR SBN yields **from the engine, as things stand** | The server presents a certificate for a different name; I will not disable TLS verification. Re-test later; manual download remains possible. |
| Antara and Kontan feeds for a **public or paid** product without written permission | Terms are personal/non-commercial. |
| IDX Data Reference scraped from issuer sites as a free replacement | High maintenance, per-issuer terms. |

---

## (d) Provider-question checklist

Send in writing, keep replies as the rights record.

**IDX Data Services (idxdata@idx.co.id) and redistributors (RTI sales@rti.co.id, IQ Plus marketing@iqplus.info, Antara/IMQ cs@imq21.com, IDX-STI contact@idxsti.co.id)** (addresses from the [2026 pricelist](https://www.idx.id/media/auobyarx/idx-catalogue-pricelist-updated-2026.pdf), p.30)
1. Which product set gives, for all ~960 stocks and the indices, daily OHLCV, value, frequency, and foreign buy/sell? Exact monthly fee for each row (Equity EoD Professional, Basic, Indices, Indices Weight, Recapitulation) and for a startup/application developer.
2. Is the use (a public or paid retail research app that shows end-of-day prices and derived signals, with a server-side database) a Display, Non-Display (which of the four categories) or both licence? Are derived indicators (breadth, movers, screening) allowed to be shown without a display licence?
3. Delivery format, file or API, time of daily availability, corrections policy, adjusted vs raw prices, **history depth and price of a historical backfill from 2020-01-01** (and older via TICMI).
4. Is there a corporate-actions/suspension feed (IDX Data Reference) and does it include record/payment dates, rights, warrants, UMA?
5. Can the data be stored for a stated retention period, and shown to logged-in free users and paying users? Redistribution to third parties by API?
6. Free trial terms, minimum term, security deposit (300% of monthly fee per the pricelist), network requirement (is a leased line mandatory for indirect delivery?).

**EODHD / Twelve Data / Index Alpha / Sectors.app**
1. Is Indonesia (XIDX / `.JK`) included in the named plan, with how many tickers, how much history, and is the upstream the exchange or a third-party aggregator?
2. Does the plan allow a company's app to store and display the data to end users? What is the professional/commercial price and does it include redistribution?
3. Adjustment method and corrections for splits and rights; EOD availability time.
4. Terms on caching and derivative works; attribution; right to keep data after cancellation.
5. Index Alpha only: source of the IDX feed, ToS, whether `source=idx` is licensed, and the price of history before 2025-01-01.

**BPS (webapi.bps.go.id):** commercial-use approval or cooperation-agreement process; rate limits; list of indicators and update calendar.

**Antara, Kontan, other publishers:** written permission to ingest headline + link (+ teaser if allowed) for a commercial app; attribution wording; feed URLs.

**World Bank, IMF:** confirm CC BY 4.0 on the Pink Sheet file itself (check the workbook's own note) and the IMF file's terms.

**OJK:** whether automated retrieval of the press-release list is acceptable and whether a feed or dataset exists.

---

## (e) Technical sketches against the existing engine contracts

The engine already has the pieces: `SourceDefinition { id, host, kind: "eod" | "intraday" | "reference" | "disclosure" | "news" | "macro", policy }` and `defineSource` in `services/engine/src/registry.ts`; the shared `Fetcher` (honest UA `ENGINE_USER_AGENT`, per-host rate limit, ETag cache, raw store, block detection) used through `fetchFor`/`parseDocument` in `src/jobs/common.ts`; cron `JobDefinition`s in `src/jobs/`; idempotent upserts with source precedence for `daily_prices` in `src/db/ingest.ts`, `upsertMacro` in `src/db/market-info.ts`. No contract change is needed for any item below except where stated.

**1. Open macro and commodities (S).** Register `world-bank-pinksheet` (`host: thedocs.worldbank.org`, `kind: "macro"`, one request/2 s) and `imf-pcps`. One monthly job (cron around the 3rd-5th, since the next World Bank update is 2026-11-03) fetches the XLSX with conditional GET; a parser reads the sheet with series codes (verify the coal, palm oil, nickel, gold column names first) and calls `upsertMacro` with `series` like `wb.coal_aus`, `unit`, `asOf` = month, source and raw ref. BPS follows the same shape with `kind: "macro"`, an `ENGINE_BPS_API_KEY` env var, and one job per dataset id, only after the key and commercial-use approval exist. Serve through the existing `/v1/macro`. Attribution strings go in the response `meta`.

**2. OJK press releases (S).** `ojk-press` (`host: www.ojk.go.id`, `kind: "news"`), a 30-minute job during office hours that fetches only page 1 of the list and parses date, title, link into `news_items` (`outlet: "OJK"`, headline + link only, existing dedupe and retention). No contract change. Add the source's honest terms note to `/v1/meta/health`.

**3. Vendor EOD (M).** `vendor-eod-<name>` with `kind: "eod"`, enabled by a new `ENGINE_VENDOR_EOD_ENABLED` flag, off by default and documented as "needs a written licence" like `ENGINE_ARJUM_EOD_ENABLED`. Daily job after 17:00 WIB: one bulk-last-day call, map to `daily_prices` rows (open/high/low/close/volume; `value`, `frequency`, foreign stay null if the vendor lacks them), source id and `asOf`; extend the source-precedence list in `src/db/ingest.ts` so licensed vendor rows outrank unofficial rows and are never blended. Backfill job (low priority, nightly, resumable by symbol) uses per-symbol history from 2020-01-01, then splits/dividends into `corporate_actions`. Respect the existing `eod_sessions` coverage accounting, so a partial vendor day reports `PARTIAL`, not `COMPLETE`. The call budget (1 per bulk day, ~960 for backfill, 100,000/day quota) leaves headroom.

**4. Index Alpha foreign flow (S).** `index-alpha` (`host: indexalpha.id`, `kind: "eod"`), bearer token env var, reads `x-ratelimit`/`/usage` before each run like the arjum job (`src/jobs/foreign.ts`). Fill `foreignBuy/foreignSell` in `daily_prices` for the most liquid symbols first via `/foreign-flow/batch` (50 per call), stopping at a configurable budget. Broker summary needs a new table (not in the first-cut model); defer until the rights answer is known.

**5. Operator push endpoint (M).** `POST /v1/admin/eod/ingest` behind `ENGINE_ADMIN_TOKEN`, mirroring `POST /v1/admin/ownership/upload`: body is CSV or JSON of `{symbol, date, open, high, low, close, volume, value?, frequency?, foreignBuy?, foreignSell?}` plus an `X-Source` label and licence reference; Zod-validated per row with per-row errors; raw copy with sha256 dedupe in the raw store; upsert into `daily_prices` with a new source id `operator-upload` placed in the precedence list. Same route serves licensed IDX EoD files delivered by a redistributor and a separately operated collector (one fixed address, honest UA, limits identical to the engine's). No change to `/v1/*` read routes.

## Unknowns that block a decision

- Exact IDX EoD fee per product, and display vs non-display classification (pricelist text extraction ambiguous; ask IDX).
- Whether IDX EOD is inside EODHD's cheapest plan, and EODHD/Twelve Data commercial terms.
- Index Alpha's terms and data provenance.
- Pink Sheet series list, IMF terms, Kontan feed URLs, Bisnis and Emitennews feeds, DJPPR data (TLS).
- Real field coverage and adjustment behaviour of every vendor (no key was used).

## Sources

IDX: [Data Services](https://www.idx.id/en/products/idx-data-services), [2026 catalogue and pricelist](https://www.idx.id/media/auobyarx/idx-catalogue-pricelist-updated-2026.pdf), [terms of use](https://www.idx.id/en/terms-of-use). Vendors: [EODHD pricing](https://eodhd.com/pricing), [JK page](https://eodhd.com/exchange/JK), [EODHD terms](https://eodhd.com/financial-apis/terms-conditions), [Twelve Data pricing](https://twelvedata.com/pricing), [exchanges](https://twelvedata.com/exchanges), [Index Alpha pricing](https://indexalpha.id/id/pricing), [endpoints](https://indexalpha.id/id/docs/endpoints), [Marketstack pricing](https://marketstack.com/pricing), [Sectors docs](https://docs.sectors.app/), [Pasardana terms](https://pasardana.id/term-of-use). Open data: [World Bank commodity markets](https://www.worldbank.org/en/research/commodity-markets), [WB data terms](https://data.worldbank.org/summary-terms-of-use), [IMF commodity prices](https://www.imf.org/en/Research/commodity-prices), [BPS WebAPI developer](https://webapi.bps.go.id/developer/), [FRED API terms](https://fred.stlouisfed.org/docs/api/terms_of_use.html), [BI web service](https://www.bi.go.id/biwebservice/wskursbi.asmx?op=getSubKursLokal4). Media/regulator: [OJK terms](https://www.ojk.go.id/id/Pages/syarat-dan-kondisi.aspx), [OJK press releases](https://www.ojk.go.id/id/berita-dan-kegiatan/siaran-pers/Default.aspx), [Antara terms](https://www.antaranews.com/ketentuan-penggunaan), [Antara RSS list](https://www.antaranews.com/rss), [Kontan RSS](https://www.kontan.co.id/rss), [CNBC Indonesia robots](https://www.cnbcindonesia.com/robots.txt), [Emitennews robots](https://www.emitennews.com/robots.txt).
