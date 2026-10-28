# IDX-BEI integration (HakaPro side)

IDX-BEI is a private service on the internal Docker network. This document covers only what HakaPro consumes
and the rules it applies. The service's own API surface and operations are documented in its private repository.

## Configuration (Data Engine)

| Variable | Default | Meaning |
|---|---|---|
| `IDX_BEI_ENABLED` | `false` | Registers the `idx-bei-api` source, the `idx-bei-issuer-import` job and the inventory read |
| `IDX_BEI_API_URL` | `http://idx-bei:8000` | Internal origin only: no path, query or credentials. Never a request parameter |

The browser never talks to IDX-BEI. The app reads the engine's `/v1` routes only, and the engine calls two
fixed read-only paths. It never forwards user input, never calls any write or trigger endpoint, and never
starts collection in the service.

## What HakaPro reads

| Engine use | Read | Notes |
|---|---|---|
| Dataset inventory (`GET /v1/integrations/idx-bei`) | ingestion status | Dates per time series; an inventory check time is not market-data freshness |
| Issuer profiles (`idx-bei-issuer-import`) | company reference snapshot | Read from the snapshot file so its own capture time is kept |

Verified 2026-10-28: the service holds **no dated time series**. Stock, broker and index series report 0
dates, and price and broker reads answer "not found". The only dataset with records is the company reference
snapshot (973 companies, captured 2026-08-26).

## Issuer profiles

- **Used:** IDX-IC classification (sector → sub-industry), directors, commissioners, shareholders
  (name, percentage) and subsidiaries (name, percentage, line of business). They map to the native IDX record
  keys (`Nama`, `Jabatan`, `Persentase`, `BidangUsaha`), so the stock Ownership tab renders them unchanged.
- **Never used:** snapshot prices and daily change, ratios and statement values, and any generated opinion or
  rating in the snapshot. The parser whitelists fields, and tests assert none of these leak.
- **Validation:** the envelope must have a capture time and at least one company. A malformed company or
  nested record is skipped and counted. Codes must exist in `securities` (FK). `N/A` classifications and a
  company name equal to its code are treated as missing.
- **Transport:** a 30 s timeout per attempt; 2 attempts with backoff, on 429/5xx/network errors only; a
  16 MB cap; a JSON content type; and a circuit breaker (3 failures → 5 min cooldown).
- **Persistence:** the job runs at 07:20 WIB daily and writes one transaction into `idx_issuer_profiles`:
  `source=idx-bei-api`, `as_of` = snapshot capture time, `retrieved_at` = read time. The conflict update only
  touches rows this source wrote. It never moves a row to an older snapshot and skips unchanged rows, so
  repeats are no-ops and native IDX profiles stay authoritative. No migration is needed.
- **Serving:** `/v1/stocks/{s}/profile` includes `provenance {source, capturedAt, retrievedAt}`. For IDX-BEI
  rows `meta.dataAsOf` is the capture time and freshness is `HISTORICAL`. The app shows
  "Snapshot {date} · source: IDX-BEI (company snapshot)" instead of presenting it as current.

## Not integrated

Prices, indices (including IDX-IC sector levels for sector rotation), broker summaries and foreign flow are
absent from the service. Those features keep their existing sources and truthful states. Loading dated series
into IDX-BEI is outside this integration.

## Rollback

Set `IDX_BEI_ENABLED=false` and redeploy the engine. Imported rows stay labelled `idx-bei-api`. Remove them
with `DELETE FROM idx_issuer_profiles WHERE source = 'idx-bei-api'` (it touches no native row). The profile
route then answers 404 again, and the Ownership tab hides the section.
