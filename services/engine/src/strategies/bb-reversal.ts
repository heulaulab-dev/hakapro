// BB REVERSAL (STRATEGY-RULES draft §5, assumed long side only): a close below the lower Bollinger band within the last
// W sessions, then a close back inside the band, up on the day. Evaluated after gate G on the gate's checked rows.
import { atLeast, bollinger, round, type Bands, type CheckedBar } from "./indicators";
import type { RuleOutcome } from "./breakout";
import { bbReversalInputRows, type BbReversalParams } from "./rules";
import { plainIdr } from "./wording";

export function evaluateBbReversal(bars: CheckedBar[], p: BbReversalParams): RuleOutcome {
  if (bars.length < bbReversalInputRows(p)) return { matched: false, failed: "inputs" };
  const closes = bars.map((bar) => bar.close);
  const t = bars.length - 1;
  const band = (index: number) => bollinger(closes, index, p.period, p.stdDevs);

  // 1–2. Most recent pierce in [t−W, t−1] whose band was meaningful (bandwidth ≥ min). A pierce exists but every
  // pierce session had a narrow band → rule 2; no pierce at all → rule 1.
  let pierced = false;
  let pierce: { index: number; bands: Bands } | null = null;
  for (let s = t - 1; s >= t - p.pierceWindow; s -= 1) {
    const bands = band(s);
    if (!bands) continue;
    const basis = p.pierceBasis === "low" ? bars[s].low : bars[s].close;
    if (!(basis < bands.lower)) continue;
    pierced = true;
    if (atLeast(bands.bandwidthPercent, p.minBandwidthPercent)) { pierce = { index: s, bands }; break; }
  }
  if (!pierced) return { matched: false, failed: "rule1" };
  if (!pierce) return { matched: false, failed: "rule2" };

  // 3. Re-entry: C[t] > lower[t].
  const today = bars[t];
  const bands = band(t)!;
  if (!(today.close > bands.lower)) return { matched: false, failed: "rule3" };

  // 4. Up on the day.
  const previousClose = bars[t - 1].close;
  if (!(today.close > previousClose)) return { matched: false, failed: "rule4" };

  // 5. Closed above its open.
  if (p.requireBullishCandle && !(today.close > today.open)) return { matched: false, failed: "rule5" };

  const width = bands.upper - bands.lower;
  const percentB = width === 0 ? 0 : (today.close - bands.lower) / width;
  const pierceBar = bars[pierce.index];
  return {
    matched: true,
    sortKey: percentB,
    reasons: [
      { kind: "criterion", key: "closedBelowBand" },
      { kind: "criterion", key: "backInsideBand" },
      ...(p.requireBullishCandle ? [{ kind: "criterion", key: "bullishCandle" } as const] : []),
    ],
    metrics: [
      { key: "closeIdr", value: today.close, unit: "idr" },
      { key: "lowerBandIdr", value: round(bands.lower, 2), unit: "idr" },
      { key: "middleBandIdr", value: round(bands.middle, 2), unit: "idr" },
      { key: "upperBandIdr", value: round(bands.upper, 2), unit: "idr" },
      { key: "percentB", value: round(percentB), unit: "ratio" },
      { key: "pierceCloseIdr", value: pierceBar.close, unit: "idr" },
      { key: "pierceLowerBandIdr", value: round(pierce.bands.lower, 2), unit: "idr" },
      { key: "pierceBandwidthPercent", value: round(pierce.bands.bandwidthPercent), unit: "percent" },
      { key: "sessionsSincePierce", value: t - pierce.index, unit: "count" },
      { key: "changePercent", value: round((today.close / previousClose - 1) * 100), unit: "percent" },
    ],
    notes: [
      `${p.pierceBasis === "low" ? "Traded" : "Closed"} below the lower Bollinger band (${p.period}, ${p.stdDevs}) on ${pierceBar.date} `
        + `(Rp ${plainIdr(p.pierceBasis === "low" ? pierceBar.low : pierceBar.close)} vs Rp ${plainIdr(pierce.bands.lower)}).`,
    ],
  };
}
