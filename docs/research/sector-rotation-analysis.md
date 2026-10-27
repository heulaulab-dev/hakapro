# Sector Rotation Analysis (RRG-style) — methodology & data

Status: **experimental / internal**. The sector-index inputs come from TradingView's
public scanner snapshot (see `services/engine/src/sources/tradingview.ts`), which this
project uses under its unofficial, internal-use provider policy. **This data is not
licensed for commercial redistribution.** The feature is presented as research only and
is gated on sufficient in-house history (see "Activation").

## 1. What this is (and is not)

A **Relative Rotation Graph (RRG)** plots each sector on two axes relative to a benchmark:

- **X — RS-Ratio**: relative *strength* vs the benchmark.
- **Y — RS-Momentum**: the *momentum* of that relative strength.

Both axes are centred on **100** (neutral). The four quadrants:

| Quadrant | RS-Ratio | RS-Momentum | Reading |
|---|---|---|---|
| Leading | ≥ 100 | ≥ 100 | strong & still improving |
| Weakening | ≥ 100 | < 100 | strong but losing momentum |
| Lagging | < 100 | < 100 | weak & still deteriorating |
| Improving | < 100 | ≥ 100 | weak but recovering |

**This is not the proprietary JdK RS-Ratio®/RS-Momentum®.** Those formulas are not public.
What follows is an **independent, transparent approximation** built from standard, publicly
documented techniques (price relatives, moving averages, rolling standardisation). It must
never be labelled or presented as the JdK calculation.

It measures **relative** strength and momentum — not absolute price appreciation, and not a
buy/sell signal. A quadrant is a description of recent *relative* behaviour, nothing more.

## 2. Formulas (exact)

Inputs: a sector daily close series `S(t)` and a benchmark daily close series `B(t)`.
They are first **aligned on the intersection of trading dates** where both have a finite
close, sorted ascending. No interpolation; gaps simply shrink the aligned set.

Parameters (all explicit and configurable, `RrgParams`):

| Param | Symbol | Daily default | Weekly default | Meaning |
|---|---|---|---|---|
| `smooth` | s | 5 | 4 | SMA length applied to the price relative |
| `normWindow` | N | 20 | 12 | rolling window for standardising RS-Ratio |
| `momentumWindow` | M | 10 | 5 | rolling window for standardising momentum |
| `scale` | k | 1 | 1 | spread multiplier around 100 |

Steps (every rolling statistic uses the window **ending at `t`**, so there is **no
look-ahead**):

1. **Price relative** `rel(t) = S(t) / B(t)`  (benchmark close must be > 0, else null).
2. **Smoothed relative** `rs1(t) = SMA_s(rel)` — mean of the last `s` relatives.
3. **RS-Ratio** `RSR(t) = 100 + k · z_N(rs1)(t)`, where `z_N` is the rolling
   **population** z-score of `rs1` over the last `N` values:
   `z = (rs1(t) − mean_N) / sd_N`. If `sd_N = 0`, the point is null (no division by zero).
4. **Raw momentum** `mom(t) = RSR(t) − RSR(t−1)` (first difference of the ratio).
5. **RS-Momentum** `RSM(t) = 100 + k · z_M(mom)(t)` — rolling population z-score of `mom`
   over the last `M` values; `sd_M = 0` → null.
6. **Quadrant** from `(RSR, RSM)` against the 100/100 lines (table above; ≥100 counts as
   the upper/right side).

### Why 100 is the justified neutral

Both axes are `100 + k·z`. A z-score is 0 exactly when the current value equals its rolling
mean, so **100 means "relative strength (or its momentum) is at its own recent average."**
The centre is a property of the normalisation, not an arbitrary offset. Typical values land
in ~94–106 (|z| ≲ 3) but are **not clamped** — extreme moves show as extreme coordinates.

### Warm-up / minimum observations (derived, not assumed)

The first valid RRG point needs, in aligned observations:
`(s−1)` for the SMA, `+(N−1)` for the first z-score, `+1` for the first difference,
`+(M−1)` for the momentum z-score.

**`minObservations = s + N + M − 1`.** Daily defaults → **34** aligned closes for a single
point; a trajectory ("tail") of length `T` needs `33 + T`. There is **no calendar-date
threshold** — activation is purely this observation count (see `minObservations()`).

## 3. Trajectories, direction, velocity

- **Tail**: the last `T` valid points in chronological order (older points are drawn more
  faded; the newest is the live marker). Tails never reorder or interpolate history.
- **Direction vector**: `(dx, dy)` between the previous and latest points; the arrowhead
  points along it. `angleDeg = atan2(dy, dx)`.
- **Rotation velocity**: Euclidean distance between consecutive points (RRG units/period).
- **Historical playback** renders the tail ending at the *selected* timestamp and uses
  **only observations at or before it** — never future data.

## 4. Interval handling

Weekly mode resamples the aligned daily closes to the **last close of each ISO week**, then
applies the same formulas with the weekly parameter defaults. Weekly is the more
conventional RRG cadence; daily is offered because our in-house history is short.

## 5. Missing-data & determinism rules

- Align on dates present (and finite) in **both** series.
- A rolling window that is not yet full → that point is null (not fabricated).
- `sd = 0` in any window → null (never `NaN`/`Infinity`).
- Output is deterministic given identical inputs and parameters.
- "Insufficient data" (fewer than `minObservations` aligned points) is **distinct** from a
  valid neutral 100 reading, and is surfaced as such in the UI.

## 6. Data availability (as of 2026-10-27)

- Benchmark **IHSG (`COMPOSITE`)**: in `index_daily`, ingested daily. (Yahoo `^JKSE`
  backfill is possible for deeper history but is unofficial/internal.)
- Sector indices in `index_daily`: **6 of 11** — ENERGY, BASIC, INDUST, HEALTH, FINANCE,
  PROPERT. Missing: **NONCYC, CYCLIC, TECHNO, INFRA, TRANS** — these do not resolve on the
  sanctioned TradingView scanner and have no confirmed free/licence-free series (see the
  source investigation). The feature renders whatever sectors are present and names the gap.
- History depth: **~6 daily observations** (job started 2026-10-19). This is **far below**
  the 34-observation minimum, so the workspace renders in its **insufficient-data** state
  and activates automatically as `index_daily` accrues.

## 7. Limitations

- Custom approximation; results depend on parameter choice (window sizes especially).
- Short in-house history; no backfill for the sector indices within current constraints.
- 6/11 sector coverage until the missing tickers or a licensed source are resolved.
- Experimental/internal data — not a licensed or official IDX analytics product.
- Relative, descriptive analytics — not predictive, not investment advice.
