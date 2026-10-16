# Connection Network (Jaringan Koneksi) — Data Engine spec

Status: **N1 reviewed 2026-10-03. Decision: no connection graph in Phase 1.** This document is now the spec for the
Data Engine phase. In Phase 1, the useful parts live in the stock **Insiders** tab ("Holders" view, see "Phase 1
outcome" below). The bounded overlap feature is deferred, and no paid arjum quota will be bought for now.

**Provider conduct** (MIGRATION §10): the N1 probes of undocumented arjum paths and the user-agent change made after a
Cloudflare block were mistakes. They are not to be repeated. Only documented endpoints the app uses are called.
Date: 2026-10-03. Investigated: arjum public docs + live responses (user's key), the HeulaTrade repo
(read-only), the ported HAKAPRO data layer and fixtures, and the upstream `nichsedge/idx-bei` repo
(MIT) that HeulaTrade's `idx-bei` service reads its snapshots from.

Live calls spent on N1: 40 × `/api/insiders/{code}` (20 symbols, all pages for 7 of them, ≤3 pages
for the rest), 6 path probes (403), 1 health. Paced at 1.5 s. No crawler, cron, or storage was created.

Hard rules this document is checked against (from the feature spec): disclosed facts only; every
edge carries `source`, `asOf`, `kind`; neutral language; individuals only as disclosed, no
person-to-person edges; no new DB/background jobs (otherwise STOP → Data Engine); freshness never
LIVE; the graph is never the only view.

---

## 1. Sources inventory

| # | Source | What it holds | Reachable from HAKAPRO today | Usable for edges |
|---|---|---|---|---|
| A | arjum `GET /api/insiders/{code}` | Disclosed insider/≥5% holder **transactions** with before/after holding | **Yes** (live, already ported: `insiders` capability) | Yes — the only live source |
| B | arjum: any shareholder / ownership / profile endpoint | — | **Does not exist.** `/api/shareholders`, `/ownership`, `/holders`, `/kepemilikan`, `/profile`, `/company` → 403 "Endpoint ini tidak dibuka untuk pemanggilan API Key. Silakan gunakan 13 endpoint resmi" | — |
| C | idx-bei `GET /v1/stocks/{symbol}/profile` (HeulaTrade `services/market-api/app.py`) | Issuer profile from `companyDetailsByKodeEmiten.json`: directors, commissioners, shareholder composition, subsidiaries | **No** — needs `MARKET_API_URL` (not configured anywhere) | Not as-is (undated, §5) |
| D | Upstream `idx-bei/data/1%ownership-2026-02-27.csv` | Every holder ≥1% of every listed issuer on one date, with investor type | **No** — a static file in a third-party repo; no service exposes it | Only via a Data Engine (§6) |
| E | arjum broker summary / accumulation / done details, `broker_code` on insider rows | **Trading flow by broker code** (e.g. `YU`, `DH`) | Yes | **Never** — brokers ≠ owners (§1.4) |
| F | Upstream `network_alpha_data.json`, `power_map_export.json` | A derived "smart money" network merged with political/LHKPN data (`bijak-beli`) | No | **Rejected** — derived scores, not disclosures; includes person-to-person and political links |

### 1.1 Source A — arjum insiders (real response shape)

Params: `page` (from 1), `limit` (≤15, enforced; `ARJUM_LIMITS.insiders`), `action_type`
(buy/sell/cross/…). Envelope: `stock_code, count, total, page, page_size, total_pages, items[]`.
Items are **sorted newest first** (verified on all 20 symbols).

Item fields (all 522 sampled items have exactly these 13):

| Field | Observed | Note |
|---|---|---|
| `name` | upper-case free text, ≤60 chars | The only entity key. No holder ID of any kind. |
| `date` | `YYYY-MM-DD`, 2020-01-21 … 2026-09-30 | Transaction date → edge `asOf` |
| `action_type` | buy 326, sell 145, transfer 27, cross 17, right_issue 5, capital_reduction 2 | |
| `nationality` | local 410, foreign 112 | Not stable per name (see §3) |
| `previous_value` / `current_value` | share counts, `"13,885,425,500"` | `previous_value: "0"` = first disclosure |
| `previous_percentage` / `current_percentage` | `"48.21"`, precision varies (`"5.0021"`) | Holding after the transaction |
| `changes_value` / `changes_percentage` | signed strings | |
| `price_formatted` | `"6,982"`, `"0"` for transfers | |
| `broker_code` | empty on 422/522; otherwise a broker code | Executing broker — **not an owner** |
| `badges` | `DIREKTUR` 135, `KOMISARIS` 58, `PENGENDALI` 21, empty on the rest | Role as disclosed |

ID-like scan: no field carries an ID, and no value has ≥10 consecutive digits outside the share-count
fields. Nothing government-ID-like is present.

**Coverage meaning:** this is a *transaction* feed. A party appears only if it reported a change
since ~2020 (insiders and ≥5% holders under the disclosure rules). It is **not** the shareholder
register: a holder that never transacted, the public float, and treasury shares are absent.

Real data-quality issues seen (all must be shown as disclosed, not "fixed"):

- **Mirrored same-day rows.** CBRE 2026-09-17: OMUDAS INVESTMENT HOLDCO `57.98 → 61.13` and
  `61.13 → 57.98`; CBRE 2025-09-17 and 2023-11-08: `buy 0.00 → 61.13` plus `sell 61.13 → 0.00` for the
  same holder. Ordering within a date is not meaningful, so "latest disclosed holding" can be
  ambiguous and must be reported as such.
- `sell` with an unchanged percentage (`5.57 → 5.57`), and percentages rounded differently across
  rows of the same holder.
- Busy days: BREN's first page (15 rows) is a single date.

### 1.2 Source C — idx-bei company profile (real upstream shape)

952 issuers. The upstream JSON keys per issuer: `Profiles, Sekretaris, Direktur, Komisaris,
KomiteAudit, PemegangSaham, AnakPerusahaan, KAP, Dividen, BondsAndSukuk, IssuedBond`.

| Section | Fields | Coverage |
|---|---|---|
| `Direktur` | `Nama, Jabatan, Afiliasi` | 952 issuers, 3,728 rows |
| `Komisaris` | `Nama, Jabatan, Independen` | 952 / 3,307 |
| `PemegangSaham` | `Nama, Kategori, Jumlah, Persentase, Pengendali` | 951 / 8,681 |
| `AnakPerusahaan` | `Nama, BidangUsaha, Lokasi, Persentase, JumlahAset, MataUang, Satuan, StatusOperasi, TahunKomersil` | 696 / 7,591 |

`PemegangSaham.Kategori` mixes holders and aggregates: `Lebih dari 5%` 2,007, `Direksi` 2,236,
`Komisaris` 1,544, `Saham Treasury` 951, `Masyarakat Warkat`/`Non Warkat` 939 each,
`Saham Pengendali`/`Non Pengendali` 23, `Kurang dari 5%` 19. `Pengendali: true` on 1,303 rows.
Aggregates (`Masyarakat…`, `Saham Treasury`) are not entities and must never become nodes. Some
issuers even list `Masyarakat` as a "Lebih dari 5%" holder name (27 issuers).

Findings:

- **No data date anywhere** in shareholder, director, or commissioner rows. The only dates are on
  KAP, dividends, bonds and the listing date. The upstream file was last committed 2026-08-25, but
  that is an ingestion date, not a disclosure date.
- **`Profiles` contains `NPWP` and `NPKP`** (company tax registration numbers) plus internal `id` /
  `DataID`. These are government-ID-like and must be stripped at the schema boundary and never
  stored or displayed.
- HeulaTrade bug, recorded for reference only (HeulaTrade is read-only): `app.py` reads
  `entry.get("Direksi")`, but the upstream key is `Direktur`, so its profile endpoint always returns
  `directors: []`. Its UI guessed field names (`Nama ?? NamaPemegangSaham ?? Name`); the verified
  names are listed above.

### 1.3 Source D — ≥1% ownership snapshot (real shape)

`DATE, SHARE_CODE, ISSUER_NAME, INVESTOR_NAME, TOTAL_HOLDING_SHARES, PERCENTAGE, LOCAL_FOREIGN, INVESTOR_TYPE`
— 7,257 rows, 955 issuers, one date (`27-Feb-2026`), median 7 and at most 28 holders per issuer,
5,226 distinct investor names. Numbers use Indonesian separators (`3.200.142.830`, `"41,10"`).
`INVESTOR_TYPE`: CP 2,886, ID 2,566, IB 405, MF 339, SC 307, OT 255, IS 199, PF 49, FD 7,
blank 244. `LOCAL_FOREIGN`: L 5,436, A 1,577, blank 244. No ID-like values.

It is the only source with **both a disclosure date and an entity type**, and the only one that makes
a reverse lookup cheap (it's a single file). But it is a static third-party copy, already 7 months
old, and its origin, cadence, and redistribution rights are unverified. It presumably comes from the
IDX/KSEI ≥1% shareholder publication; that needs confirming before any use.

### 1.4 Brokers are not owners

- `broker_code` on an insider row is the **executing member firm** for that transaction (empty on 81%).
- Broker summary/accumulation/done-details are **trading flow per broker code** over a date range.
- No source links a broker code to a beneficial owner. These must never produce holder edges, and
  the UI copy must not imply that "broker X accumulating" means "X owns".

A related trap: **custodian / nominee accounts appear as holders.** In arjum insiders:
`DBS VICKERS SECS SINGAPORE (PTE) LTD A/C CLIENTS` (BRPT), `THE BANK OF NEW YORK MELLON` (TLKM),
`MORGAN STANLEY AND CO INTERNATIONAL PLC` (GOTO). In the ≥1% snapshot the most "connected" names are
all custodians or brokers: `UOB KAY HIAN PRIVATE LIMITED` (66 issuers), `BANK OF SINGAPORE LIMITED`
(38), `UBS AG SINGAPORE BRANCH` (27), `DBS BANK LTD.` (25). A naive graph would turn them into false
hubs. They are registered holders, not owners: give them a separate edge kind
(`registered_holder_nominee`), keep them out of hub ranking, and add the note "account held on behalf
of clients".

---

## 2. Reverse lookup ("which other stocks does this holder appear in?")

| Source | Holder search | Cost of answering it |
|---|---|---|
| arjum | **None.** `/api/insiders/search?q=…` is parsed as stock code `SEARCH` → 0 items. The MCP server's 2 batch tools take stock codes, not holders, and draw on the same quota. | Crawl every issuer: ~955 issuers × `ceil(total/15)` pages |
| idx-bei profile | None (per-symbol only) | One 10.5 MB file in memory, but no service exposes it |
| ≥1% snapshot | Trivial (one 660 KB file) | Needs ingestion → Data Engine |

**Page cost from the 20-symbol sample** (record totals per stock: TINS 2 … TPIA 466; total 2,691
records = 191 pages; median 6.5 pages, max 32):

- **1-hop, one focus stock, full history:** 1–32 calls (median ~7). A cap of 4 pages (60 newest
  events) covers 9 of the 20 sampled stocks completely; the rest show their newest 60 events.
- **Full reverse index over the universe:** roughly 955 × 5–10 pages ≈ **5,000–9,500 calls per
  sweep**, plus re-sweeps to stay current. The sample leans to large caps, so the real figure is
  probably at the low end. The free daily quota is not documented and the API exposes no quota
  headers. Paid add-ons are +5k / +10k / +20k / +50k requests per day for 30 days; the quota resets
  at 00:00 WIB; 429s were seen when crawling fast. A sweep is a **crawler plus storage**, so the hard
  rules require the Data Engine path.
- Note: Cloudflare in front of arjum blocked a discovery script's default Python user agent (error 1010). Under
  MIGRATION §10 that block should have been reported instead of retried with another user agent. All HAKAPRO traffic
  now sends the honest `PROVIDER_USER_AGENT`, which arjum accepts (checked 2026-10-03 with one call through the app).

## 3. Entity-name quality

There is no stable identifier in any source, so the name is the key. The real variants observed:

| Pattern | Real examples |
|---|---|
| Legal form dropped/kept inconsistently (arjum) | `DIAN SWASTATIKA SENTOSA`, `SARATOGA INVESTAMA SEDAYA`, `RAJAWALI CORPORA` (no PT) vs `ALAMTRI RESOURCES INDONESIA TBK` (Tbk kept) |
| Truncation | `OMUDAS INVESTMENT HOL` (2023–2025 rows) vs `OMUDAS INVESTMENT HOLDCO` (2026 rows), same issuer CBRE |
| Case, punctuation, whitespace (profile) | `PT Danantara Asset Management (Persero)`, `PT Danantara Asset Management ` (trailing space), `PT Danantara Asset Management`, `PT DANANTARA ASSET MANAGEMENT` |
| Cross-source form | arjum `DANANTARA ASSET MANAGEMENT` vs ≥1% `PERUSAHAAN PERSEROAN (PERSERO) PT DANANTARA ASSET MANAGEMENT` |
| Suffix order / commas | `HUSIN INVESTAMA, PT.` vs `PT HUSIN INVESTAMA`; `PANINVEST TBK, PT` vs `PT PANINVEST Tbk` (53 such groups in the ≥1% file) |
| Titles / degrees | `YULIOT, IR`; `LO KHENG HONG` (arjum) vs `LO KHENG HONG. DRS` (≥1%) |
| Initials | `A. WIDODO MULYONO` and `ANTONIUS WIDODO MULYONO` (same issuer; nationality `local` on one, `foreign` on the other) |
| Alias lists in one field | `TAN HO HIEN/SUBUR/SUBUR TAN` |
| Mononyms (collision risk) | `HENDRA`, `RUDY`, `SANTOSO`, `MICHAEL`, `RAYMOND`; `RUDY`, `RUDY SUHENDRA`, `RUDY SUPARMAN` are three different issuers' directors |
| Shared surname tokens | `PRAJOGO PANGESTU` vs `BARITONO PRAJOGO PANGESTU`: distinct disclosed persons, must never be linked |

**Entity type (person vs organisation):** arjum has no type field. `DIREKTUR`/`KOMISARIS` badges
imply a person. `PENGENDALI` is used for both people and companies. A legal-form regex missed 16 of the
30 organisations in the sample (e.g. `INTEGRA INDO LESTARI`, `NEGARA REPUBLIK INDONESIA`). So arjum entities stay **`unknown`** unless a badge says
otherwise. The ≥1% file's `INVESTOR_TYPE` (`ID` = individual, `CP` = corporate, …) is the only
reliable type.

Other per-name fields aren't stable either: badges vary for one holder in one issuer (`YULIOT, IR`
with and without `KOMISARIS`), and `PENGENDALI` appears on BREN but not on BRPT/CUAN for the same
name.

**Proposed resolution policy (for N2, if scoped):**

1. Organisations: deterministic normalisation only. Upper-case, collapse whitespace, strip
   punctuation and the legal-form tokens `PT, TBK, PERSERO, PERUSAHAAN PERSEROAN, LTD, LIMITED, PTE`.
   Merge only on exact normalised equality. Truncated prefixes are **not** auto-merged; they stay
   as separate rows labelled "possibly the same disclosed name".
2. Individuals: no normalisation beyond case and whitespace, and no fuzzy, initial, or title
   matching. A person-to-stock edge across two issuers is shown only on an exact name match, labelled
   "same disclosed name; identity not verified". No person-to-person edges, ever.
3. The raw disclosed name is always displayed next to the normalised group, together with each
   edge's source row.
4. A curated alias table, which variants like Danantara would need, is persistent state and
   therefore Data Engine scope.

## 4. Cross-stock overlap actually present in the sample

From arjum insiders across 20 symbols (exact name match):

- `PRAJOGO PANGESTU` → BREN (badge `PENGENDALI`), BRPT, CUAN
- `DANANTARA ASSET MANAGEMENT` → BMRI, TLKM

From the ≥1% snapshot, the same entities reach further: Danantara (normalised) → BMRI, GIAA, JSMR,
KRAS, PTPP, SMGR, TLKM, WIKA, WSKT; `PRAJOGO PANGESTU` → BRPT, CUAN, TPIA. Only 2 of the 86
distinct arjum names overlap across the sampled stocks. Insiders alone yield a **sparse** network;
real 2-hop structure needs the ≥1% data.

## 5. Freshness per source (never LIVE)

| Source | Edge `asOf` | Label | Why |
|---|---|---|---|
| arjum insiders | transaction `date` of the row the edge is derived from | `HISTORICAL` per edge; the panel shows `leastFresh` with the newest date | Event-based disclosures, filed after the transaction (reporting lag not exposed by the API) |
| idx-bei profile | **none** | `UNAVAILABLE` under the current rule (`asOf: null` ⇒ UNAVAILABLE) | Undated snapshot; the file commit date is not a disclosure date and must not be shown as one |
| ≥1% snapshot | `DATE` column (2026-02-27) | `HISTORICAL` (7 months old today; `STALE` if presented as current) | Point-in-time file |
| Broker flow | — | n/a | Not an ownership source |

"Latest disclosed holding" for a holder–issuer pair is the `current_percentage` of the
newest-dated row. When several rows share that date and disagree (CBRE example), the edge shows all
of them with an "ambiguous same-day disclosures" marker rather than picking one.

## Phase 1 outcome (built 2026-10-03)

Stock → Insiders tab → **Holders** (default; Transactions remains a toggle):

- Disclosures load newest first, one provider page (15) per user "Load older disclosures" click. Nothing loads in the
  background. A source that ignores `page` (recordings) stops with "older disclosures aren't available".
- Grouping (`src/lib/insider-holders.ts`):
  - Organisations merge on exact equality after legal-form normalisation.
  - People and names of unknown type merge only on the exact name (case and whitespace aside) and are labelled
    "identity not verified".
  - Truncated organisation names are flagged "possibly the same", never merged.
- Each holder shows: every disclosed name variant, its kind (organisation / person / custodian-nominee / type not
  stated), roles from badges as disclosed, the latest disclosed holding with its as-of date, and its event history
  with the source and date range.
- Contradictory same-day results show as **Ambiguous**, with every value; none is picked (live example: CBRE
  2026-09-17, 61.13% and 57.98%).
- Custodian/nominee account names get their own kind and the note "registered on behalf of clients; not presented as
  the owner".
- Coverage is stated ("newest N of M disclosures"), plus the note that this is not the shareholder register.
- Provenance and freshness follow §5: `source` from the envelope, `asOf` = newest transaction date, `HISTORICAL`.

idx-bei profile data is **not** used for connection edges (no dates). Where the Ownership tab shows it, it is labelled
with the retrieval date and dataset, and tax/ID numbers are stripped at the parsing boundary (tested at the API route).

## 6. Recommendation (N1, as submitted)

**Phase 1 (fits the hard rules): 1-hop from arjum insiders, plus a bounded opt-in overlap.**

- **Focus-stock 1-hop:** issuer → disclosed holders. One edge per (holder, issuer) with
  `source: "arjum/insiders"`, `asOf` = newest transaction date, `kind` ∈ `disclosed_holding`
  (with the latest `current_percentage`), `disclosed_role` (from badges: director, commissioner,
  controller), or `registered_holder_nominee`. Fetch pages on demand, newest first, capped at 4 pages
  (60 events), with "older disclosures not loaded" plus a load-more control. That costs 1–4 calls per
  view, cached server-side for the session TTL using existing infrastructure: no DB, no job. The
  table view is the primary view (and the default on mobile); the graph is a visualisation of the
  same rows.
- **Partial 2-hop, bounded and opt-in:** "these holders also appear in disclosures of: [stocks the
  user selects — their watchlist or a comparison set, ≤10 symbols]". At ≤10 symbols × ≤2 pages it
  is ≤20 calls, fired only on user action. It uses the matching policy from §3 (exact normalised
  organisation names; exact person names, labelled unverified). It is honest about coverage: the
  copy says "among the selected stocks", never "all holdings".
- Out of Phase 1: idx-bei profile edges (undated, not configured) and anything from brokers.

**Requires a Data Engine (STOP — not buildable under the current rules):**

- A true reverse lookup ("every listed issuer where X appears") and a universe-wide 2-hop.
- Recommended feed: the dated **≥1% shareholder data** (one file per period, all issuers, with
  investor type). It is far cheaper and more complete than crawling arjum (~5–9.5k calls per sweep).
  It needs: the origin, cadence and redistribution rights confirmed; periodic ingestion; storage; a
  curated alias table; and a nominee/custodian classification.
- Optional: profile composition (controller flag, public float) once a disclosure date can be
  attached. Strip NPWP/NPKP at ingestion.

**Decisions needed from you to proceed to N2:**

1. Scope: Phase 1 as above (1-hop + bounded overlap), or wait for a Data Engine.
2. Overlap candidate set: the user's watchlist, a free-form comparison list (≤10), or both.
3. Whether to request a paid arjum quota tier (only relevant if the Data Engine path picks arjum
   crawling over the ≥1% feed).
4. Whether to pursue the ≥1% data's origin and licence for a later Data Engine phase.

---

## Data Engine inputs

### ≥1% shareholder list (research only — not ingested, copied or committed)

Researched 2026-10-03 from news coverage, OJK's press release, and third-party repos. **idx.co.id and ksei.co.id
blocked automated reads (403)**, so IDX/KSEI page wording below comes from search snippets and secondary quotes and is
marked *unverified*. No PDF or dataset was downloaded.

| Question | Finding | Confidence |
|---|---|---|
| Original publisher | **KSEI** compiles the data; **IDX (BEI)** publishes it as an announcement, "Pemegang Saham di atas 1% (KSEI)", under idx.co.id → Berita → Pengumuman | High (Kontan, detik, OJK) |
| Format | **PDF** via IDX e-reporting (`/StaticData/NewsAndAnnouncement/ANNOUNCEMENTSTOCK/From_EREP/<yyyymm>/…pdf`); the March 2026 release is ~73 pages. There is no official CSV: GitHub CSVs are extractions. The original also has nationality, domicile, and scrip/scripless split columns | High / medium |
| Schedule | **Monthly.** First release 3 Mar 2026 after market close, with positions as of **27 Feb 2026** (matches the snapshot file name). Each release shows the last trading day of the prior month. A May 2026 release exists. The exact release day each month is unverified | High (cadence), medium (day) |
| Legal basis | **Keputusan Dewan Komisioner OJK No. 1/KDK.04/2026** (KSEI and IDX as public ownership-data providers). Part of OJK's 8-point capital-market integrity plan (1 Feb 2026), confirmed delivered in OJK press release SP 64/OJK/DKPU/IV/2026 (2 Apr 2026). Related: IDX rule I-A revised (effective 31 Mar 2026); monthly registration reports (SK LBRE) add >5% holdings and ≥10% beneficial owners from the 30 Apr 2026 report; KSEI investor classification expanded to 39 types | High (OJK), unverified (letter S-20/PM.1/2026) |
| Terms — KSEI | The cover letter in the PDF reportedly says the data "hanya dapat digunakan oleh PT Bursa Efek Indonesia (BEI) sesuai dengan tujuan penggunaan sebagaimana tercantum dalam Keputusan OJK". That is no public redistribution licence | Unverified (third-party quote) |
| Terms — idx.co.id | Non-commercial use and quotation allowed with full attribution **and access date**. **No web scraping/crawling.** Commercial use or redistribution needs **prior written permission from BEI and/or the original owner** (here KSEI). IDX also runs a paid data-licence regime (Layanan Data BEI); whether announcements fall under it is unknown | Unverified wording (search snippets) |
| Upstream copy (`nichsedge/idx-bei`) | Names "KSEI" but gives no source URL. Added in one commit on 2026-09-10. MIT covers the code only, with no data licence or attribution. Its columns are a subset of a third-party PDF extraction | Verified (repo files) |

**Implications for a Data Engine:**

1. A commercial product (HAKAPRO) needs **written permission from IDX, and likely KSEI,** before ingesting or showing
   this data. Third-party CSV copies are not a licensed source.
2. If licensed, ingest from the official monthly PDF (or a licensed feed), not by scraping idx.co.id. Keep `asOf` =
   the position date, `source` = "KSEI via IDX announcement <id>", with attribution and access date as the terms ask.
3. Keep the custodian/nominee classification (`INVESTOR_TYPE` plus the name patterns from §1.4). Strip any ID numbers
   at ingestion.
4. Open questions for the product owner: who requests the licence, and whether IDX's paid data services include a
   machine-readable feed of this list.

---

## Ownership snapshot type and change engine (HAKA-33, built 2026-10-16)

Pure domain code only. Nothing is fetched or ingested, and the tests use synthetic tickers and holders (`TEST1`,
`PT CONTOH DUMMY TBK`, …). The ≥1% data still needs the licence decision above before any real snapshot exists.

**Type** (`src/lib/ownership/snapshot.ts`, Zod 4):

- One row per disclosed holder line: `ticker, holderKey, holderName` (as disclosed), `holderKind`
  (`person | organisation | custodian_nominee | government | public | unknown`), `shares` (integer string, `numeric(24,0)`),
  `percent` (decimal string, ≤6 decimals, `numeric(9,6)`), `snapshotDate` (the position date, never the retrieval
  date), and `source {dataset, reference, retrievedAt}`.
- A snapshot is every row for one ticker and one position date. It also carries `thresholdPercent` (`"1"` for the ≥1%
  list, `"0"` for a complete register) and `issuedShares` when a source states it.
- `ownershipHolderKey` follows §3: `org:` plus the legal-form-normalised name (organisation, custodian/nominee,
  government); `name:` plus the exact name (person, unknown); and `public:` for aggregates such as "Masyarakat".

**Engine** (`compareOwnershipSnapshots` in `src/lib/ownership/changes.ts`): two snapshots of one ticker → one change per
holder key. Shares are compared as BigInt and percentages as integer micro-percent, so `shareDelta` and `ppDelta` are
exact strings.

| Status | When | Before / after values |
|---|---|---|
| `INCREASE` / `DECREASE` / `UNCHANGED` | In both months. Decided on shares when both months state them, otherwise on percent (`COMPARED_BY_PERCENT`). | Both stated |
| `NEW` | Missing earlier, present later | From a threshold list: before is **unknown** (`null`, flag `PRIOR_HOLDING_UNKNOWN`). From a complete register: before = 0. |
| `EXIT` | A **stated** zero: a 0-share row, or absence from a complete register (threshold 0) | After = 0 |
| `BELOW_THRESHOLD` | Present earlier, missing from a later threshold list | After unknown (`null`) |
| `AMBIGUOUS` | Conflicting rows for one key in one month, or nothing comparable | `null`; every row kept |

Why `BELOW_THRESHOLD` and not `EXIT`: the ≥1% list only shows holders at or above 1%. A holder that drops off may have
sold everything, or may still hold 0.99%. The list can't tell these apart, so the engine doesn't claim an exit. Each
side's absence is read against that snapshot's own threshold. Suggested UI wording: "No longer in the ≥1% list".

Flags: `PERCENT_CHANGED_SHARES_UNCHANGED` (issued shares changed, i.e. a corporate action, or rounding);
`ISSUED_SHARES_CHANGED` (both months state issued shares and they differ, so a split isn't read as buying);
`SHARES_AND_PERCENT_DIVERGE`; `DUPLICATE_ROWS_COLLAPSED` (identical values); `CONFLICTING_DUPLICATE_ROWS`;
`NO_COMPARABLE_VALUES`; `HOLDER_NAME_CHANGED`; `HOLDER_KIND_CHANGED`; and `AGGREGATE_ROW`. Conflicting duplicate lines
are never summed: two same-name lines may be two different people (the §3 mononym problem).

Refusals (`ok: false`): `TICKER_MISMATCH`, `NOT_CHRONOLOGICAL`, `SAME_MONTH`, and `NON_ADJACENT_MONTHS`. The last one is
skipped only with `allowNonAdjacent`, and the result is then marked `adjacent: false, monthsApart: n`. Every change keeps
the holder's verbatim rows (with `source`) from both months, and each side's summary lists all of its sources.

Percentage precision is whatever the source published: the KSEI list uses 2 decimals, so a pp delta below 0.01 can't be
seen, and a small trade can show as `UNCHANGED` in percent but not in shares.

**Schema gap.** The existing `ownership_snapshots` table (`src/db/schema/app.ts`) does **not** fit as is. No
migration has been added. A Data Engine slice would need:

1. `holder_key text not null` and `holder_kind text not null` (check on the six kinds). An alias table would make the key
   curated state.
2. Source provenance: `source` is one text column today. It needs `source_dataset`, `source_reference` and
   `retrieved_at timestamptz`. `updated_at` is the row-write time, not the retrieval time.
3. Per-snapshot facts: `threshold_percent` and `issued_shares`. These are best kept in a parent table such as
   `ownership_snapshot_sets (id, symbol, snapshot_date, dataset, threshold_percent, issued_shares, source_reference,
   retrieved_at)`, with rows referencing it.
4. The unique key `(symbol, snapshot_date, holder_name)` rejects lines the source really publishes twice under one name.
   It would become unique on `(snapshot_set_id, source_reference)` (the line locator), so duplicates are kept and
   flagged rather than lost.
5. Optional source signals for the free-float methodology: `investor_type` (as stated) and `local_foreign`. ID numbers
   are still stripped at ingestion (MIGRATION §10.5).
