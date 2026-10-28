# Private IDX-BEI API integration

Verified 2026-10-28 from the running HakaPro Engine container. Base URL is
`http://idx-bei:8000`, alias `idx-bei`, network `hakapro-internal`.
`/health`, `/docs` and `/openapi.json` returned 200. Service version 0.2.0.
No public domain or host port is configured. Engine network membership was added
live: it must be made declarative before an Engine container replacement.

## Live OpenAPI inventory

All responses declare an unspecified JSON schema (`{}`), except validation errors.
No authentication scheme is declared. Query parameters are optional unless noted.
Pagination uses limits; there are no cursor/page envelopes declared.

| Method | Endpoint | Parameters / request |
|---|---|---|
| GET | /health | none |
| GET | /api/dashboard-data | none |
| GET | /api/companies | none |
| GET | /api/compounder-screen | min_score=60, exclude_traps=true, category, limit=50 |
| GET | /api/signals | date (YYYY-MM-DD) |
| GET | /api/stock/{ticker} | required ticker; limit=120 |
| GET | /api/stock/{ticker}/blocks | required ticker |
| GET | /api/broker-flow | date, top_k=10 |
| GET | /api/peers/{ticker} | required ticker |
| GET | /api/dividend/{ticker} | required ticker |
| GET | /api/dividend | min_yield=3, year=2026, limit=25 |
| GET | /api/drift | none |
| GET | /api/graph/ubo/{ticker} | required ticker |
| GET | /api/graph/network/{ticker} | required ticker |
| GET | /api/graph/centrality | top_n=20 |
| GET | /api/graph/cross-holdings | none |
| POST | /api/query/sql | sql required; limit=50 |
| GET | /api/stealth-accumulation | date, lookback_days=5, min_turnover_rp=1000000000 |
| POST | /api/backtest | strategy, holding_days, top_n, min_turnover_rp, start_date, end_date, stop_loss_pct, take_profit_pct, position_sizing |
| POST | /api/broadcast | arbitrary JSON object |
| GET | /api/system/ingestion-status | none |
| POST | /api/system/trigger-ingestion | job_type=daily, date, start_date, end_date, concurrency=8 |
| GET | /api/system/jobs | limit=10 |
| GET | /api/system/jobs/{job_id} | required job_id |

OpenAPI declares 200 and, for parameter/body validation, 422 with
`detail: [{loc, msg, type, input?, ctx?}]`. Source handlers additionally return
400/404 for unavailable/invalid datasets and may return 500 on dependency errors.
Source also implements `/ws/stream`, static `/data`, dashboard and asset mounts,
and a root redirect. WebSocket data comes from broadcast calls; it is not a
verified exchange real-time feed.

## Verified data and mapping

Live health sample: `{"status":"ok","service":"idx-bei-api","version":"0.2.0"}`.
Live inventory returned `status=warning`, `health_score=55`, with zero dates for
stock_summary, broker_summary and index_summary. Each partition inventory has
`total_dates`, `start_date`, `end_date`. Dates were null. The adapter validates
these fields and exposes them through authenticated Engine API handling at
`GET /v1/integrations/idx-bei`, with source, checkedAt and availability status.
An inventory observation time is not a market-data freshness timestamp.

Snapshot files match the repository-bundled data byte-for-byte. Their deployment
mtime must never be interpreted as a trading date or evidence of recent collection.
Companies/dashboard snapshots cannot safely replace existing fresh market feeds.
Stock source code returns `{ticker, records, latest}` with `time`, `open`, `high`,
`low`, `close`, `volume`. Some OHLC fields are filled from close upstream; volume
may be filled with zero. Do not ingest these as authentic OHLCV without provenance
and field-quality checks. Broker-flow returns `{summary, top_brokers}` only when
stored broker data exists; no broker history is currently available.

There is no index-history REST endpoint. `/api/indices/history` returned 404.
No read API was added because no real index-summary history exists in this service.
Existing HakaPro storage remains `index_daily` and `daily_prices`; no migrations,
new market tables or competing schedulers were introduced.

HakaPro `/v1/indices/history` returned six observations each for COMPOSITE, IDX30,
IDXBASIC, IDXENERGY, IDXFINANCE, IDXHEALTH, IDXINDUST, IDXPROPERT and LQ45, spanning
2026-10-19 to 2026-10-27. IDXNONCYC, IDXCYCLIC, IDXTECHNO, IDXINFRA and IDXTRANS have
zero observations. Counts describe persisted Engine data, not this microservice.
Missing sessions require comparison with the existing exchange calendar; weekends
must not be classified as missing. RRG remains subject to existing aligned-history
requirements and must not be enabled with fabricated sector levels.

## Security and rollout

Configure Engine `IDX_BEI_ENABLED=false` (default),
`IDX_BEI_API_URL=http://idx-bei:8000`. Preserve `ENGINE_IDX_PRIMARY_ENABLED=false`.
No scheduled collection is registered. The client calls only the fixed read-only
inventory route, rejects redirects and credential-bearing URLs, times out after
five seconds and retries selected transient HTTP statuses once. Failures retain
an explicitly STALE last good inventory in process memory; restart clears it.
Market persistence and existing market responses are untouched.

The source has unauthenticated SQL, ingestion trigger, broadcast and backtest
endpoints and wildcard CORS. Do not proxy these routes or expose the service to
browsers. Base URL is server configuration, never a request parameter. Only trusted
containers may join the private network. No credentials belong in NEXT_PUBLIC vars.

Production deployment and scheduling remain pending approval. No DB migration is
required. Before deployment, persist Engine membership in `hakapro-internal`
through reviewed Coolify configuration; retain its existing network. Set the flag
only after verifying private DNS and the inventory contract. Rollback by disabling
IDX_BEI_ENABLED and deploying the previous Engine image; persisted market history
requires no rollback.

## Remaining implementation

This commit provides the typed inventory integration. Market-data ingestion and
frontend widgets are pending reliable dated datasets. Historical sector integration
is blocked by zero source history and no index read endpoint. Do not replace
existing RRG or market source paths with this inventory endpoint.
