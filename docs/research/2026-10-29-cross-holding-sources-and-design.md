# Cross-holding: source semantics and production design

Date: 2026-10-29  
Scope: HakaPro ownership/network experience and the private `hakapro-idx-bei` service.

## Conclusion

HakaPro can safely add a first version of **direct, reciprocal company holdings** from the existing KSEI monthly `>=1%` snapshots. It must not present that result as a complete beneficial-ownership or control graph. The snapshot is a thresholded, point-in-time disclosure, and company-name matching is an entity-resolution problem. Missing rows are not proof of zero ownership.

The current IDX-BEI `/api/graph/cross-holdings` route should not be used as the user-facing source without a semantic correction. Its Neo4j query links one `Insider`/controller node to two companies; that is a common-controller or group-overlap result, not necessarily a legal company A -> company B -> company A cross-holding. Its local fallback contains hard-coded examples and therefore is not a verified production dataset.

## What “cross-holding” means

Indonesian company law distinguishes direct and indirect cross-ownership. The official OJK-hosted text of Law No. 40/2007 describes direct cross-holding as one company owning shares in another company while that other company owns shares in the first; indirect cross-holding is through one or more intermediary companies. The same provision generally prohibits the arrangement, subject to statutory exceptions. See [OJK, Law No. 40/2007, Article 36](https://www.ojk.go.id/sustainable-finance/id/peraturan/undang-undang/Documents/5.%20UU-40-2007%20PERSEROAN%20TERBATAS.pdf).

For HakaPro, use these distinct terms:

- **Direct reciprocal company holding:** two verified listed-issuer entities have directed ownership rows in both directions in the same snapshot.
- **Common-controller overlap:** the same person/entity is linked to two companies. This may indicate a group relationship, but it is not proof of reciprocal company ownership.
- **Indirect/UBO network:** one or more intermediary entities or beneficial-owner/control relationships. This needs a source and entity resolution that the public `>=1%` list does not provide by itself.

## Official source and its limits

The [IDX Share Ownership Data page](https://www.idx.co.id/en/listed-companies/share-ownership-data-of-listed-companies/) says that shareholder data above 5%, above 1%, investor type, and classification are obtained from KSEI. IDX also disclaims the accuracy, completeness, and timeliness of the published information. The [IDX/KSEI announcement](https://web.ksei.co.id/files/uploads/press_releases/press_file/id-id/252_bei_dan_ksei_terbitkan_informasi_kepemilikan_saham_perusahaan_tercatat_di_atas_1_20260303225811.pdf) describes the above-1% information as a monthly publication for listed companies.

Consequences for the feature:

1. A row is a dated disclosure, not a live position. Store and display the position/snapshot date and the source reference.
2. The dataset only exposes holders at or above the stated threshold. HakaPro's own copy explicitly says that below-1% holders are not disclosed and that this is not the same as zero (`src/i18n/messages/en.json`, `ownership.kseiNote`). A reciprocal pair can therefore be undercounted or absent.
3. Holder names and investor types are not a stable legal-entity identifier. A corporate name can be a listed issuer, private company, nominee, custodian, or an affiliate with a similar name. Do not use fuzzy matching to manufacture an ownership edge.
4. KSEI's [AKSes facility](https://web.ksei.co.id/education/akses-facility) gives an investor access to that investor's own positions and mutations; it is not a public issuer-wide cross-holding API. KSEI's [holding-composition archive](https://web.ksei.co.id/archive_download/holding_composition) is aggregate local/foreign composition, not a named company-to-company graph.
5. Beneficial-owner information has a different access model. The [IDX transparency announcement](https://www.idx.co.id/en/news/press-release/2591) describes beneficial-owner information at 10% or more as information provided to interested parties on request under the applicable procedure, rather than a complete public graph. Do not label an inferred graph as verified UBO data.

The repository also records the commercial constraint: `hakapro/docs/PROGRESS.md` and `hakapro/docs/features/CONNECTION-NETWORK.md` require written permission for commercial reuse of the IDX/KSEI `>=1%` data. The source/provenance and licence decision must remain attached to any production feature.

## Existing implementation audit

### HakaPro

The ownership UI already separates KSEI ownership from other issuer data. It labels KSEI as `>=1% shareholders (KSEI)` and warns that holders below 1% are not disclosed. The Investor Network copy currently says that cross-holdings are unavailable in the current dataset (`src/i18n/messages/en.json`, `networkLimited`). This is the correct conservative behavior until a reciprocal-edge computation is backed by the KSEI snapshot and freshness metadata.

The current application has monthly KSEI snapshot ingestion and ownership APIs, but no persisted cross-holding relation. Do not merge KSEI rows with IDX-BEI issuer-profile/shareholder disclosures: they are different datasets with different dates, provenance, and semantics.

### `hakapro-idx-bei`

`python/src/idx/api.py` exposes `/api/graph/cross-holdings`. In `python/src/idx/graph.py`, `detect_cross_holdings()` queries two `OWNS` edges from a shared `Insider` node to two `Company` nodes and returns `controller`, `comp1`, `comp2`, `pct1`, and `pct2`. That is a common-controller/conglomerate-overlap query, even though the route is named “cross-holdings”. If Neo4j is unavailable, the function returns local fallback examples. Neither behavior is sufficient evidence for a verified company-to-company reciprocal edge.

The route is on the private Docker network and should remain internal. If retained, document/rename its semantic output to `common-controller-overlap`; do not proxy it to an unauthenticated browser endpoint or use its fallback rows as production ownership facts.

## Recommended production design

### Phase 1: direct reciprocal edges from KSEI snapshots

Build the feature in the HakaPro Data Engine, next to the existing ownership snapshot model:

1. Maintain a versioned issuer master mapping each listed symbol to its verified legal/company names and aliases. Prefer exact normalized matches plus an explicit reviewed alias table; reject ambiguous or fuzzy matches.
2. For each KSEI row, consider an edge only when the holder is an explicitly verified listed issuer. Exclude public/aggregate labels, custodians and nominees, individuals, and unresolved names. Preserve the raw holder name and investor type for auditability.
3. Emit `fromSymbol -> toSymbol` with shares, percentage, position date, snapshot id, source reference, and a `mappingMethod`/review status.
4. A reciprocal cross-holding pair exists only when both `A -> B` and `B -> A` are present for the same snapshot date (or explicitly selected comparable period). Canonicalize symbol order so the pair is returned once.
5. Mark the result `coverage: "disclosed_at_or_above_1_percent"` and `completeness: "incomplete"`. Never infer “no cross-holding” from a missing edge.

Suggested endpoint:

```http
GET /v1/stocks/{symbol}/cross-holdings
```

```json
{
  "data": {
    "symbol": "BBCA",
    "snapshotDate": "2026-09-30",
    "freshness": "historical",
    "coverage": "disclosed_at_or_above_1_percent",
    "completeness": "incomplete",
    "edges": [
      {
        "fromSymbol": "A",
        "toSymbol": "B",
        "percent": "12.34",
        "shares": "1234000000",
        "reciprocalPercent": "2.10",
        "reciprocalShares": "210000000",
        "sourceReference": "ksei:2026-09-30:<snapshot-id>"
      }
    ],
    "limitations": [
      "Only holders disclosed at or above 1% are evaluated",
      "Entity matching is limited to reviewed listed-issuer aliases",
      "This is not an indirect ownership or UBO graph"
    ]
  }
}
```

The UI can add a **Verified direct cross-holdings** section to Investor Network, visibly separate from KSEI holder rows and IDX-BEI issuer disclosures. Show the snapshot date, freshness badge, `>=1%` coverage, and the incomplete-coverage warning. A common-controller result, if later exposed, must have its own label and explanation.

### Phase 2: indirect ownership and control

Only add indirect loops, control, or UBO claims after HakaPro has an authorized/licensed source with stable entity identifiers and documented definitions. A graph inferred from similar names, percentages, or the `idx-bei` fallback is not enough. The official transparency model above is a reason to keep these claims out of the public “verified” feature for now.

## Verification and test requirements

Add deterministic tests around the snapshot computation:

- `A -> B` and `B -> A` in the same snapshot produce one reciprocal pair.
- A one-way row produces no reciprocal pair, but remains a disclosed directed edge if the API exposes it.
- A row below the threshold or absent from the threshold list does not prove zero ownership.
- Aggregate/public labels, custodians/nominees, individuals, and unresolved names are excluded from company edges.
- Duplicate raw rows are rejected or surfaced as an ambiguity; they must not be silently summed.
- Different snapshot dates are not paired without an explicit comparison policy.
- Every response carries source reference, position date, freshness, coverage, and completeness.
- Stale snapshots are labeled historical/stale and are never presented as current.

## Decision

The production-safe next step is a HakaPro-native reciprocal-edge computation over the existing, authenticated KSEI snapshot store, with reviewed issuer aliases and explicit limitations. Keep the current IDX-BEI graph route private and treat its current output as common-controller overlap until its data model is changed and independently verified. Do not claim complete cross-holding, indirect ownership, or UBO coverage from the public `>=1%` snapshots.
