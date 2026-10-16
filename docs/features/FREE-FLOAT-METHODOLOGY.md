# Estimated free float: HAKAPRO methodology v0.1

> **DRAFT: awaiting owner approval.** Version `0.1-draft`. Nothing computed with this methodology may be shown to users
> until the owner approves it (see "Open questions"). On approval the version becomes `0.1`.

- Plane: HAKA-34 (Ownership Intelligence roadmap). Companion: HAKA-33, the change engine (`CONNECTION-NETWORK.md` →
  "Ownership snapshot type and change engine").
- Implementation: `estimateFreeFloat` / `classifyHolder` in `src/lib/ownership/free-float.ts`. That file is the only
  implementation of these rules. Every result carries `methodology.version`.
- Data: the KSEI ≥1% list via IDX announcements is **not licensed** for HAKAPRO yet (`CONNECTION-NETWORK.md` → "Data
  Engine inputs"). Until that is settled, this methodology runs only on synthetic fixtures.

## 1. Four figures that must never be confused

| Figure | What it is | Who produces it | How it is shown |
|---|---|---|---|
| **Disclosed holding (≥1%)** | One line of the KSEI ≥1% list at a position date | KSEI, published by IDX | As disclosed, with position date and source |
| **Strategic holding** | HAKAPRO's classification of a disclosed holding (§3) | HAKAPRO (judgement) | With the rule that classified it |
| **Estimated free float** | HAKAPRO's computation from disclosed holdings (§4) | HAKAPRO (estimate) | Label in §6, range, version, as-of, source |
| **Official / regulatory free float** | A figure published by the exchange, the regulator or the issuer | Never HAKAPRO | Only with publisher, as-of and source; never computed, adjusted or back-filled by HAKAPRO |

The result type enforces the split. The estimate is `figureType: "ESTIMATE"` and `isOfficial: false`, both literal
types. An official figure, if supplied, goes in a separate `official` field (`figureType: "OFFICIAL"`) and does not
change the estimate.

*Unverified, for the owner to confirm against the rule text:* IDX's own definition of free float (Rule I-A) is
understood to exclude controlling shareholders, directors and commissioners, holdings of 5% or more, and treasury
shares. This draft adopts the same exclusions where the data allows (§3). It does not claim to reproduce the official
figure.

## 2. Inputs

- One **ownership snapshot**: one ticker and one position date, with each disclosed line (`holderKind`, `percent`,
  `source`) and the dataset threshold (`"1"` for the ≥1% list).
- Optional **signals** per holder key: `controller`, `boardMember`, `affiliate`, `treasury`, and `investorType` (the
  code exactly as the source states it). Each signal must come from a dated, sourced disclosure: arjum badges
  `PENGENDALI` / `DIREKTUR` / `KOMISARIS`, the investor type on the ≥1% line. Signals are never guessed from a name.
  They are matched to snapshot holders only through the holder-key policy (exact normalised organisation names; exact
  person names), never fuzzily.
- Optional **overrides**: an owner-approved class for one holder key. Each override has a mandatory `reason` and
  `reference` (who decided, when).
- Optional **official figure**: carried through untouched.

## 3. Classification: strategic, portfolio, unknown

- **Strategic:** held to control or influence the issuer, or otherwise not available for trading.
- **Portfolio:** held as a financial investment and plausibly tradable.
- **Unknown:** the data can't tell.

Rules are tried in order. The first match wins. Aggregate lines such as "Masyarakat" (`holderKind: public`) are not
holders: they are listed under `excludedAggregates` and are never classified or counted.

| # | Rule | Class | Example (synthetic) |
|---|---|---|---|
| 1 | `OVERRIDE`: owner-approved decision for this holder key | as decided | "BUDI CONTOH", 1.2% → strategic, reason "disclosed founder" |
| 2 | `TREASURY`: the issuer's own repurchased shares (signal) | strategic | "PT CONTOH DUMMY TBK (treasury)" |
| 3 | `GOVERNMENT`: `holderKind` government | strategic | "PT DANA NEGARA FIKTIF", 3.10% |
| 4 | `CONTROLLER_OR_BOARD`: disclosed controller, director or commissioner (signal) | strategic | A 1.2% holder with a `KOMISARIS` badge |
| 5 | `AFFILIATE`: disclosed affiliate of the issuer or its controller (signal) | strategic | A sister company at 1.4% |
| 6 | `NOMINEE_ACCOUNT`: `holderKind` custodian_nominee, at any size | unknown | "DUMMY CUSTODIAN BANK A/C CLIENTS", 6.40% |
| 7 | `AT_OR_ABOVE_5_PERCENT`: disclosed holding ≥ 5% | strategic | "PT CONTOH DUMMY TBK", 55.25% |
| 8 | `FUND_INVESTOR_TYPE`: stated investor type `MF` (mutual fund), `PF` (pension fund) or `IS` (insurance), below 5% | portfolio | "REKSA DANA CONTOH SAHAM", 2.05%, type `MF` |
| 9 | `DEFAULT_UNKNOWN`: everything else | unknown | A person at 3%; a corporate at 2% |

Conservative defaults, and why:

- A **nominee or custodian account is never portfolio**. The registered holder isn't the owner, and the beneficial
  owner could be anyone, including the controller. This rule comes before the 5% rule, so a large nominee line stays
  *unknown*. The headline figure still counts it as not free (§4).
- **5% or more is strategic** even for a fund. Rule 7 comes before rule 8.
- **No signal means unknown**, not portfolio. A 1–5% person or corporate holder is often a founder's relative or a
  group company, and the ≥1% list can't show that.

## 4. Computation

All arithmetic is exact: percentages are integer micro-percent (6 decimals), and results are 6-decimal strings.

```
disclosed   = Σ percent of classified lines (aggregates excluded)
strategic   = Σ percent of strategic lines        portfolio = Σ of portfolio lines        unknown = Σ of unknown lines
undisclosed = 100 − disclosed                     (holders below the threshold, never individually visible)

low      = 100 − strategic − unknown              (unknown counted as not free)
high     = 100 − strategic                        (unknown counted as free)
headline = low
```

- **Headline = low bound.** An estimate that overstates free float is worse than one that understates it.
- The undisclosed remainder is counted as free in both bounds. That is the main structural limitation (§5).
- **Duplicates:** a line identical in key, values and source reference is counted once (`duplicateRowsCollapsed`).
  Two lines that share a name but come from different source lines are both counted. For free float the sum is right
  whether they are one holder with two accounts or two people with the same name.
- **No estimate, rather than a wrong one** (`estimate: null` plus `unavailableReason`): `NO_DISCLOSED_ROWS`,
  `MISSING_PERCENT` (a line with only shares), or `DISCLOSED_EXCEEDS_100` (a data error).

Synthetic worked example (`TEST1`, threshold 1%): strategic 55.25 + 3.10 = 58.35; unknown 6.40 + 1.20 = 7.60;
portfolio 2.05; disclosed 68.00; undisclosed 32.00. The result is **low 34.05%, high 41.65%, headline 34.05%**.

## 5. What ≥1% data cannot tell us

Each limitation below has a caveat code. Every result carries these codes (`caveats`), so a UI can't drop them
silently.

- `BELOW_THRESHOLD_HOLDERS_UNSEEN`: directors, controllers' relatives and affiliates holding under 1% are invisible
  and are counted as free. Either bound can therefore be too high.
- `NOMINEE_BENEFICIAL_OWNERS_UNKNOWN`: custodian lines hide who owns the shares.
- `CONCERT_PARTIES_NOT_AGGREGATED`: several holders acting together, each below 5%, are not combined. The list has
  no relationship data.
- `TREASURY_ONLY_IF_SIGNALLED`: treasury shares are excluded only when a signal says so. Treasury below 1% is
  invisible.
- `LOCKUPS_AND_PLEDGES_NOT_VISIBLE`: lock-ups, pledged shares and shares in dispute are not in the list.

Also: positions are month-end only, published days later. KSEI percentages carry 2 decimals. `LOCAL_FOREIGN` is
domicile, not ownership type. Third-party copies of the list drop columns (scrip/scripless split, domicile). Free
float is not liquidity: a high estimate says nothing about trading volume.

## 6. Labelling rules

1. The figure is always called **"Estimated free float (HAKAPRO methodology v0.1)"**, or in tight space "Est. free
   float (v0.1)" with the full label in a tooltip. It is never called just "Free float".
2. It is always shown with: the range (low–high), the as-of position date, the source dataset with its reference, and a
   link to this methodology. Freshness is `HISTORICAL` (or `STALE` if the snapshot is older than the latest published
   month), never `LIVE`.
3. An official figure, when available, appears on its own line with its publisher and as-of date. It is never in the
   same cell, column or chart series as the estimate. A difference between the two is shown as a difference. Neither
   figure "corrects" the other.
4. Overridden holders show the override reason.
5. Copy is neutral. It never implies manipulation, intent or tradability ("tightly held" is fine; "illiquid", "pump",
   "smart money" are not).
6. While the methodology is a draft, nothing is shown to users. Internal displays carry "Draft methodology".

## 7. Versioning

- `FREE_FLOAT_METHODOLOGY.version` is part of every output, and any stored estimate keeps the version it was computed
  with.
- Any change to rules, order, thresholds, the investor-type list or the headline choice bumps the version: minor for
  rule tweaks, major for a change of definition. Each change gets a changelog line below. Old estimates are recomputed
  or kept with their old version; they are never relabelled.
- The label string carries the major.minor version.

## 8. Open questions for the owner

1. **Approve the draft?** Specifically the 5% strategic line and the headline = low bound. The alternatives are a
   midpoint, or showing only the range.
2. **Custodian/nominee lines:** keep them always *unknown*, or treat foreign custodians below 5% as portfolio?
3. **Fund types:** are `MF` / `PF` / `IS` the right portfolio set? Should state-linked pension funds and insurers be
   strategic? Should other KSEI investor types (out of 39) be added once the official type list is available?
4. **Government:** which entities count? Danantara and BUMN holding companies only, or any state-linked company? Who
   maintains that list?
5. **Signals from undated sources:** the idx-bei profile has controller flags but no data date (`UNAVAILABLE` under the
   freshness rule). May such a flag classify a holder, or only dated sources (arjum badges, the ≥1% line)?
6. **Overrides:** who may create them, how are they reviewed, and where are they stored? Overrides are persistent
   state, so they need the Data Engine.
7. **Official figure:** is there a licensable official free-float series (IDX data services, monthly registration
   reports)? If not, the "official" line stays empty, and is never filled with the estimate.
8. **Licence:** no real estimate can be shown until IDX/KSEI permission for the ≥1% data is settled
   (`CONNECTION-NETWORK.md` → Data Engine inputs). Who requests it?
9. **Issued shares:** what is the source for issued shares per month? The change engine and any future share-based
   estimate need it.
10. **Below-threshold wording** (HAKA-33): approve "No longer in the ≥1% list" for `BELOW_THRESHOLD`, and "New in the
    ≥1% list" for `NEW` from a threshold list.

## Changelog

- `0.1-draft` (2026-10-16): first draft. Nine ordered rules; headline = low bound; synthetic tests only.
