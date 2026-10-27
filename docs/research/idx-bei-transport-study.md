# `idx-bei` transport study and HakaPro integration

_Study date: 2026-10-27. Target: IDX prerelease red-team environment, per the project owner's authorization. No commit, push, or deployment performed._

## Original `idx-bei` implementation

Repository: [`nichsedge/idx-bei`](https://github.com/nichsedge/idx-bei). Relevant files:

- [`python/src/idx/core/client.py`](https://github.com/nichsedge/idx-bei/blob/main/python/src/idx/core/client.py) — sync and async HTTP clients.
- [`python/src/idx/scrapers/trading.py`](https://github.com/nichsedge/idx-bei/blob/main/python/src/idx/scrapers/trading.py) — `fetch_index_summary`.
- [`python/src/idx/scrapers/historical.py`](https://github.com/nichsedge/idx-bei/blob/main/python/src/idx/scrapers/historical.py) — daily historical iteration.

`GetIndexSummary` is a GET to `/TradingSummary/GetIndexSummary` with `date=YYYYMMDD`, `start=0`, and `length=9999`. It returns a DataTables envelope (`draw`, `recordsTotal`, `recordsFiltered`, `data`). The upstream scraper asks `validate_schema` and `check_schema_drift` to inspect that envelope before saving rows. Its required index-row keys include `IndexCode`, `Close`, `Volume`, `Value`, `Frequency`, and `MarketCapital`.

The sync `IDXClient` uses `curl_cffi.requests.get`, a 30-second default timeout, and `max_retries=3` (up to four attempts). It retries 403, 429, and selected 5xx statuses with exponential backoff and jitter. On 403 it changes the `impersonate` preset using the configured Chrome/Safari/Edge list. Successful sync calls sleep one second. `get_json` turns HTTP or JSON failures into `None` unless `raise_on_error=True`.

`AsyncIDXClient` holds a `curl_cffi.requests.AsyncSession` in its async context manager, adds a semaphore (default concurrency five), and has a shared retry cooldown. Its default success delay is 0.2 seconds. The historical loop builds trading dates, skips dates already stored, requests each date with the same DataTables parameters, and writes each non-empty date immediately. The async variant gathers dates with bounded concurrency. HakaPro instead reuses its existing resumable, checkpointed, five-trading-day backfill job and stores through `upsertIndexDaily`.

## TLS fingerprints, HTTP/2, and Cloudflare

A User-Agent is an HTTP request header sent after the TLS handshake. Changing it changes a string in the HTTP request; it does not change the TLS ClientHello that was already sent. JA3 fingerprints selected ClientHello fields such as offered TLS version, cipher suites, extensions, supported groups, and point formats. JA4 derives a more structured fingerprint from the ClientHello and protocol metadata. These fingerprints can be useful Bot Management signals, but they are not proof of a particular browser or person. Cloudflare documents JA3/JA4 as request fields available to Bot Management and security rules ([Cloudflare JA3/JA4 docs](https://developers.cloudflare.com/bots/additional-configurations/ja3-ja4-fingerprint/)).

After TLS negotiates the application protocol through ALPN, HTTP/2 adds observable behavior of its own, including SETTINGS parameters, frame order, flow-control updates, and pseudo-header ordering. A client can negotiate HTTP/2 yet still differ from Chrome in its TLS and HTTP/2 behavior. `curl_cffi` uses a curl build with browser-oriented TLS and HTTP/2 impersonation support; it changes more than the User-Agent ([curl_cffi impersonation docs](https://curl-cffi.readthedocs.io/en/latest/impersonate.html)).

WAF outcomes can also depend on cookies, challenge state, JavaScript signals, request headers, rate, IP/network reputation, and behavior across requests. In this run, `curl_cffi`, `httpx`, and Chromium all used HTTP/2, but only `curl_cffi` received 200. That points to client differences beyond the HTTP protocol label; it does not establish which individual signal caused the decision. JA3/JA4 are server-observed values: this endpoint did not return them, so the client comparison records them as unavailable. An authorized Cloudflare zone can expose its own fingerprint logs or return test-only diagnostic headers to make those values observable.

## Captured IDX response contract

`services/engine/src/sources/idx-index-summary.2026-10-26.fixture.json` is a captured response from the authorized endpoint for 2026-10-26. It contains 45 index rows. The DataTables envelope is present, and rows use `COMPOSITE`, `Highest`, and `Lowest`; `OpenPrice` is absent. This differed from the older inferred shape and is now covered by `idx-primary-live-fixture.test.ts`.

HakaPro's parser maps `Highest`/`Lowest` to `high`/`low`, preserves a missing open as `null`, rounds close to four decimals, maps legacy `IHSG` to `COMPOSITE`, derives `changePercent` from `Change / Previous`, and rejects malformed dates, stale dates, and non-positive closes. Unknown fields such as `IndexSummaryID` and `MarketCapital` are tolerated. The request asks for one page (`start=0`, `length=9999`); this response's 45 rows fit in that page, so no additional pagination loop is needed for the observed shape.

## HakaPro architecture and data flow

The transport is an optional Python worker behind the existing TypeScript `IdxIndexTransport` interface. It holds one `curl_cffi.AsyncSession`, sends JSON-lines requests from the engine, and closes during engine shutdown. It does not add a scheduler, cursor, table, or API. The existing `idx-index-backfill` job persists validated rows into `index_daily`; the existing `/v1/indices/history` → `/api/indices/history` path serves that table; the existing RRG page consumes it. The RRG calculation and UI already existed before this integration.

Transport failures now throw from the backfill's per-date processor. The shared backfill only advances its cursor after a successful `processDay`, so a final 403, timeout, or transport error leaves that date eligible for the next run. The worker has bounded retries, an explicit timeout, a two-second success delay, structured stderr logging, and no cookie/header/body logging. The engine option remains off unless `ENGINE_IDX_PRIMARY_ENABLED=true`.

## Client comparison

Reproduction command (the host allowlist is required):

```sh
IDX_AUTHORIZED_TEST_HOSTS=www.idx.co.id \
  .venv-idx/bin/python services/engine/python/compare_http_clients.py \
  'https://www.idx.co.id/primary/TradingSummary/GetIndexSummary?date=20261026&start=0&length=9999' \
  --timeout 20 --impersonate chrome \
  --output docs/research/idx-client-comparison.2026-10-27.json
```

Recorded from the current environment at 2026-10-27 16:43 UTC (latency is one sample and will vary):

| Client | Status | Negotiated HTTP | TLS version | JA3/JA4 | WAF outcome | Latency |
|---|---:|---|---|---|---|---:|
| Python `requests` | 403 | HTTP/1.1 | unavailable client-side | unavailable | blocked/challenge | 76.93 ms |
| Python `httpx` | 403 | HTTP/2 | TLS 1.3 | unavailable | blocked/challenge | 94.85 ms |
| `curl_cffi` (`chrome`) | 200 | HTTP/2 | unavailable client-side | unavailable | JSON response | 72.47 ms |
| Playwright Chromium (headless) | 403 | HTTP/2 (`h2`) | TLS 1.3 | unavailable | blocked/challenge | 455.05 ms |

Cloudflare `cf-ray` headers were present for the four requests (PoP `SIN`); `cf-mitigated` and test JA3/JA4 headers were absent. `httpx` and Chromium expose TLS versions in their respective client APIs here. `requests` released its connection before the TLS socket could be inspected, and `curl_cffi` does not expose the negotiated TLS version in the response API used by this harness. Client-side JA3/JA4 measurement is not substituted with guesses.

## Run and configure

Create an isolated local Python environment for the worker tests and comparison lab:

```sh
python3 -m venv .venv-idx
.venv-idx/bin/pip install -e services/engine/python
.venv-idx/bin/playwright install chromium
```

Then configure the engine for the authorized prerelease URL (base URL ends in `/primary`):

```sh
ENGINE_IDX_PRIMARY_ENABLED=true
ENGINE_IDX_PRIMARY_BASE_URL=https://<authorized-idx-prerelease-host>/primary
ENGINE_IDX_PRIMARY_PYTHON=.venv-idx/bin/python
ENGINE_IDX_PRIMARY_IMPERSONATE=chrome
ENGINE_IDX_PRIMARY_MAX_RETRIES=3
ENGINE_IDX_PRIMARY_TIMEOUT_SECONDS=30
ENGINE_IDX_PRIMARY_DELAY_SECONDS=2
```

The Docker image installs only the worker's pinned `curl_cffi` dependency. The full comparison environment (requests, httpx, and Playwright Chromium) is for the isolated lab. Do not point the comparison harness at a host unless it is listed in `IDX_AUTHORIZED_TEST_HOSTS` and approved for this test.

Run the engine transport/parser tests and Python unit/local-endpoint tests:

```sh
bun run test -- services/engine/src/sources/idx-primary.test.ts services/engine/src/sources/idx-primary-live-fixture.test.ts services/engine/src/sources/idx-curl-cffi.test.ts services/engine/src/jobs/idx-index-backfill.test.ts services/engine/src/config.test.ts
PYTHONPATH=services/engine/python .venv-idx/bin/python -m unittest discover -s services/engine/python/tests -v
```

## HakaPro transport recommendations

- Keep the source registry and shared backfill as the single ingestion path; keep client-specific behavior behind the injected transport.
- Preserve session lifecycle, timeout, retry budget, final status, and attempt count in transport telemetry. Never let a terminal failure advance a date cursor.
- Keep source identity and WAF evidence distinct: `cf-ray` and HTTP status help diagnose a result but do not identify the precise Bot Management feature that fired.
- Keep the production option explicit and the endpoint configurable. Do not silently make the source active on deployments that have not configured the authorized prerelease target.
- When other source clients need persistent sessions or protocol metadata, consider a generic transport lifecycle interface (`fetch` + optional `close`) instead of adding transport-specific branches to the central `Fetcher`.
