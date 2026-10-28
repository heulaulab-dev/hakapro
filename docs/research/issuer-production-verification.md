# IDX-BEI issuer production verification

The Engine image includes `verify-issuers.js`, a container-only, read-only check. It uses the existing `ENGINE_DATABASE_URL`, starts a read-only transaction, applies a five-second statement timeout, and prints only aggregate integrity data plus the BBCA profile and import history. It is not exposed through HTTP and does not accept SQL or user input.

Run it from the Engine container:

```sh
bun verify-issuers.js
```

The production check on 2026-10-28 found 970 `idx-bei-api` issuer rows covering 970 distinct symbols, no duplicate `(symbol, language)` keys, and BBCA profile, shareholder, director, and commissioner data. Import history showed 970 rows on the first run and 0 rows on the idempotent repeat.

The source snapshot is captured at `2026-08-26 17:31:48` WIB. The deployed IDX-BEI inventory reports no dated stock, broker, or index partitions. The service's company snapshot is byte-identical to the repository snapshot, so deployment time must not be treated as data freshness. The three skipped symbols are `MFIN`, `MASA`, and `FREN`; they are absent from the Engine securities universe and were correctly skipped rather than inserted as synthetic securities.

IDX-BEI shareholder disclosures and KSEI ownership snapshots remain separate datasets. BBCA's IDX-BEI profile is available and labeled historical; the KSEI ownership endpoint currently returns `UNAVAILABLE` because no BBCA KSEI snapshot is stored.
