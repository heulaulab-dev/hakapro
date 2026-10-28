# IDX-BEI Feature Parity in HakaPro — Design

## Intent

Bring the useful IDX-BEI data and analysis capabilities into HakaPro's existing applications. IDX is the additional data source; HakaPro's Data Engine remains the only ingestion scheduler, normalized store, API, and production service. The user selected phased native integration, with the same IDX transport pattern already proven in production.

Success means IDX data is fetched through one bounded, resumable pipeline, normalized into HakaPro's contracts, exposed through existing APIs, and visible in HakaPro screens with source/freshness information. Existing HakaPro analytics should consume the enriched data instead of being cloned from IDX-BEI.

## Current state

- HakaPro has an optional `idx-primary` source, persistent Python `curl_cffi` worker, `idx-index-backfill`, `index_daily` persistence, `/v1/indices/history` and `/api/indices/history`, and the Sector Rotation/RRG page.
- Production uses that worker against `https://www.idx.co.id/primary`. Recent production logs show scheduled index batches succeeding after a Cloudflare retry.
- The worker request is currently fixed to `GetIndexSummary`; it is not yet a general IDX endpoint transport.
- HakaPro already has normalized tables and UI/API capabilities for securities, daily prices, financial statements/ratios, corporate actions, announcements, news, stock flow, screeners, ownership, strategies, and RRG. Some capabilities currently use Yahoo, Pasardana, RSS, TradingView, or Arjum.
- IDX-BEI's documented IDX data domains are stock, broker, and index trading summaries; company profiles/details; quarterly/yearly ratios; 15 corporate-action categories; exchange-member directory; market news; and company announcements. Its README also describes analytics, CLI, MCP, and dashboard features.
- Workspace implementation now has fixture-driven index/stock/broker, issuer/ratio, corporate-action/news/announcement adapters and jobs. Broker summaries, issuer profiles, and ratio periods are modeled without duplicating the engine, and issuer/news/action/announcement reads use existing product API routes.
- The five sector codes can be parsed from the captured 45-row index response. This is parser/persistence-path evidence only; production row counts and RRG readiness still require deployment and live database verification.

## Goals

- Fetch IDX market and reference datasets through the existing IDX worker/session and Data Engine source/job abstractions.
- Reuse HakaPro's normalized tables, source provenance, rate limiting, job cursors, APIs, auth, caching, and product screens.
- Add only the minimal schema/API/UI extensions for IDX fields or product capabilities HakaPro genuinely lacks.
- Make each ingestion idempotent, resumable, contract-validated, observable, and fixture-tested.
- Provide product-level equivalents for IDX-BEI's useful analytical features inside HakaPro's existing navigation.
- Promote through develop → staging → main and Coolify after each release gate passes, following the previously authorized deployment path.

## Non-goals

- Do not deploy a second IDX-BEI backend, database, scheduler, dashboard, CLI, MCP server, or graph database alongside HakaPro.
- Do not duplicate analytics that HakaPro already provides; map those features to their existing pages and improve data inputs where needed.
- Do not fabricate unavailable values, silently reinterpret unknown fields, or claim feature coverage without an upstream fixture and a HakaPro consumer.
- Do not add arbitrary-host transport support. IDX transport is restricted to the configured official IDX/prerelease host and the endpoint allowlist.

## Approaches

1. **Native phased integration — selected.** Extend the existing IDX transport and HakaPro source/job/store/API/UI flow. This preserves one ingestion system and lets IDX progressively enrich the same contracts that HakaPro's app already consumes.
2. **Full stack replica.** Port IDX-BEI's separate CLI, MCP, database, graph, and dashboard. Rejected because it creates duplicate services and product surfaces in HakaPro.
3. **IDX-BEI as a separate upstream service.** Call its REST API from HakaPro. Rejected because it does not use the requested IDX fetch pattern and adds another service, data contract, and operational dependency.

## Architecture

### Fetch and ingest

Generalize the JSON-lines Python worker from a fixed index request to a typed IDX request operation (`endpoint`, query parameters, timeout, and request identifier). Validate endpoint paths against an allowlist under the configured IDX base URL. Keep one persistent `curl_cffi.AsyncSession`, pinned version, current default-header behavior, bounded retries/delay, structured stderr logs, and explicit close lifecycle. TypeScript owns endpoint-specific request construction and Zod parsing; the worker owns HTTP/session mechanics only.

Each IDX domain gets a source adapter and scheduled job in the existing registry. Jobs use the shared scheduler, `job_cursors`, `fetchFor`/raw-document provenance conventions where applicable, and existing idempotent DB upserts. Use conservative concurrency and per-host pacing. A failed/blocked response must not advance the relevant cursor. IDX data remains source-tagged so primary-source precedence and fallback behavior stay explicit.

### Dataset and product mapping

| IDX-BEI capability | HakaPro destination | Expected work |
|---|---|---|
| `GetStockSummary` daily OHLCV, value/frequency, foreign flow, bid/offer | `daily_prices`, stock history/flow APIs and pages | Reuse existing daily price and foreign-flow fields; add only a separately timestamped snapshot contract if bid/offer is not an EOD field. Keep existing source precedence explicit. |
| `GetBrokerSummary` | Existing broker/flow analysis APIs and product | Define a distinct date/broker contract; do not conflate IDX market-wide broker totals with Arjum's per-stock broker summary. Add storage only if the current schema cannot represent it. |
| `GetIndexSummary` | `index_daily`, indices API, RRG | Retain current implementation; transport becomes endpoint-generic without changing the index response contract. |
| Company profile list/details | `securities`, company profile API and stock/research pages | Normalize issuer identity, classification, board, listing and detail fields; keep profile retrieval time separate from source data dates. |
| `GetApiDataPaginated` financial ratios | `stock_ratios` / fundamentals pages | Preserve period and ratio-source provenance; extend accepted ratio sources or schema only after the IDX payload is fixture-verified. |
| `GetIssuedHistory` (15 categories) | `corporate_actions`, stock actions/dividend analysis | Map each IDX category to a stable HakaPro action type and retain raw category/code for reversibility. |
| `GetBrokerSearch` | broker directory and broker-facing analysis | Add a normalized broker directory contract/table only if no existing representation is suitable. |
| `GetNewsSearch`, `GetAllAnnouncement` | `news_items`, `announcements`, news/research pages | Keep news and issuer filings distinct; deduplicate by stable IDX identifiers/URLs. Initially ingest metadata and filing links, not attachment bodies, unless an existing reviewed storage contract supports them. |
| IDX-BEI eight-signal dashboard, dividend/trap analysis, strategy backtests, ownership/UBO/drift, sector rotation | Existing HakaPro screener, stealth, dividend/analysis, strategies, ownership/groups, RRG | Complete a capability mapping; reuse existing calculations and pages. Implement only missing capabilities as additions to existing routes/navigation. |

### Analytics capability map

| IDX-BEI capability | HakaPro destination | Parity assessment |
|---|---|---|
| Eight-signal daily dashboard and stealth accumulation | `/discover/radar`, `/discover/stealth`, `/discover/screener` | Reuse HakaPro's documented signal/radar contracts and measured foreign-flow coverage. These are analogous decision-support surfaces, not a claim that HakaPro reproduces IDX-BEI's exact eight formulas. |
| Dividend and value-trap analysis | Stock actions, `/stock/[symbol]/analysis`, `/stock/[symbol]/financials` | IDX actions, filings, ratios, and statements enrich these existing views. HakaPro does not currently produce IDX-BEI's proprietary dividend trap score or BUY/HOLD/SELL verdict; keep that a documented gap until its formula is specified and reviewed. |
| Strategy backtesting | `/discover/strategies` and strategy detail | Reuse the existing HakaPro strategy contract and scans. User-configurable stop-loss/take-profit vector backtests are not an equivalent capability today and remain a gap; do not imply parity from the presence of a strategies page. |
| Ownership, UBO graph, and holder drift | `/discover/ownership`, `/stock/[symbol]/ownership`, `/discover/groups` | Reuse the owner-uploaded KSEI snapshots and curated group measurements. IDX-BEI's multi-hop Neo4j UBO graph and its own ownership-drift model are not represented in the current HakaPro data contract; keep those explicitly out of parity claims. |
| Sector relative rotation (RRG) | `/discover/rotation` | Existing RRG is the consumer. IDX historical series are being replayed into `index_daily`; production parity requires verified aligned dates and UI coverage, especially for the five previously missing sector codes. |
| Technical indicators | Stock chart and analysis | Reuse existing price/chart analytics where the current HakaPro screen exposes them; no second indicator engine is added as part of IDX ingestion. |

These gaps are product-analysis gaps, not data-ingestion blockers. This delivery adds the IDX data contracts and leaves each existing screen authoritative; it does not clone IDX-BEI's CLI, MCP, graph database, or dashboard.

## Delivery phases

1. **Transport and contracts:** inventory exact IDX request/response shapes from repository source and appropriately obtained fixtures; generalize the worker safely; add endpoint request builders, schemas, normalization tests, and transport tests. The first vertical slice is recovering all 11 IDX-IC sector histories for RRG, with `IDXNONCYC`, `IDXCYCLIC`, `IDXTECHNO`, `IDXINFRA`, and `IDXTRANS` explicitly verified from parser through persistence and history API. Existing date cursors must support a deliberate, versioned replay so already-visited dates can be re-fetched without deleting stored rows or resetting unrelated jobs. Replace the current claim that those sectors have no legitimate source with observed per-code coverage and RRG history-progress messaging.
2. **Trading data:** add stock-summary backfill/current-session integration and broker-summary storage/API. Preserve current IDX index backfill and RRG path. Verify source precedence, checkpointing, and date semantics.
3. **Reference and issuer data:** ingest company directory/profile details, broker directory, and paginated IDX financial ratios into existing HakaPro contracts. Add only necessary fields and migrations.
4. **Actions and disclosures:** map all corporate-action categories; ingest IDX news and paginated announcement metadata/filing links; wire existing stock/news/research screens.
5. **Analytics parity:** audit IDX-BEI analysis outputs against HakaPro screens. Reuse equivalents and implement identified gaps in the existing app and engine, with disclosed methodology and freshness/coverage states.
6. **Production verification:** stage each coherent slice, validate real persisted rows and user-facing API/UI behavior, then promote to production through Coolify. Keep the IDX source enabled only for the configured IDX endpoint.

## Constraints and behavior

- Preserve the existing source registry and backfill scheduler; no parallel ingestion loop.
- Keep endpoint request parameters, pagination, schema, date formats, units, symbol/code mappings, and category mappings explicit and covered by fixtures.
- Store provenance per source and use HakaPro's source precedence; IDX must not overwrite higher-priority values accidentally.
- Retain structured source status, last-success time, coverage, staleness, and rejected-row counts for UI/API diagnostics.
- The HakaPro APIs remain authenticated according to their existing route policy; transport tests must not weaken user-facing authorization.
- No new external service or production WAF configuration is part of this design.

## Acceptance criteria

- Every IDX-BEI endpoint listed in the dataset table has a typed adapter, captured/authorized fixture, parser tests, and a registered ingestion or retrieval path in HakaPro.
- Trading/history jobs resume after interruption and repeated runs are idempotent.
- Existing HakaPro screens consume normalized records and show empty, stale, partial, or unavailable data honestly.
- Each analytical capability is mapped to an existing HakaPro screen or an explicitly scoped addition; there is no parallel IDX-BEI app surface.
- HakaPro CI passes; staging and production show healthy app/engine deployments and production logs confirm persisted IDX rows before a feature is called live.
- The five named sectors are retained from the 45-row `GetIndexSummary` fixture, persisted by the existing index backfill, returned by `/v1/indices/history`, and no longer described as unsupported. If daily RRG history remains below 34 aligned observations, the UI reports actual history progress rather than implying the upstream data is unavailable.

## Calls for implementation

- Build data foundations before analytics parity because analytics need normalized source data.
- Keep IDX issuer profile freshness separate from actual filing/data timestamps.
- Do not fetch/host announcement PDF contents in the first disclosures phase; preserve and validate the official links.
- Use new tables only for data with a genuinely different grain, especially daily broker market totals and broker directory records.
- Deliver and review phases separately; “feature parity” is the roadmap target, not a claim that one release makes all IDX-BEI modules live.
