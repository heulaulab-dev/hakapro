// BREAKOUT (STRATEGY-RULES draft §4): the session closed above the highest high of the previous N sessions, on clearly
// higher volume. Evaluated after gate G on the gate's checked rows (oldest first, last = t).
import type { Metric, Reason } from "@/lib/strategies/contract";
import { atLeast, atMost, before, closeLocation, mean, round, volumeOf, type CheckedBar } from "./indicators";
import { breakoutInputRows, type BreakoutParams } from "./rules";
import { plainIdr } from "./wording";

export type RuleMatch = { matched: true; sortKey: number; reasons: Reason[]; metrics: Metric[]; notes: string[] };
/** `failed` is the first qualification rule that does not hold (`rule1`…), or `inputs` when there are too few rows. */
export type RuleMiss = { matched: false; failed: string };
export type RuleOutcome = RuleMatch | RuleMiss;

export type BreakoutContext = { averageValueIdr: number | null };

const highest = (bars: CheckedBar[]) => Math.max(...bars.map((bar) => bar.high));
const lowest = (bars: CheckedBar[]) => Math.min(...bars.map((bar) => bar.low));

export function evaluateBreakout(bars: CheckedBar[], p: BreakoutParams, context: BreakoutContext): RuleOutcome {
  if (bars.length < breakoutInputRows(p)) return { matched: false, failed: "inputs" };
  const t = bars.length - 1;
  const today = bars[t];
  const previous = bars[t - 1];

  // 1. C[t] > HH_N, strictly: equal does not qualify.
  const window = before(bars, p.lookback);
  const priorHigh = highest(window);
  if (!(today.close > priorHigh)) return { matched: false, failed: "rule1" };

  // 2. RVOL over the sessions before t.
  const averageVolume = mean(before(bars, p.relativeVolumeLookback).map(volumeOf));
  const relativeVolume = averageVolume > 0 ? volumeOf(today) / averageVolume : null;
  if (relativeVolume === null || !atLeast(relativeVolume, p.minRelativeVolume)) return { matched: false, failed: "rule2" };

  // 3. Close location on t.
  const location = closeLocation(today, previous.close);
  if (!atLeast(location, p.minCloseLocation)) return { matched: false, failed: "rule3" };

  // 4. First break: C[t−1] ≤ HH_N evaluated at t−1 (= max(H[t−1−N..t−2])). Later days are not re-listed.
  if (p.requireFirstBreak) {
    const previousHigh = highest(before(bars, p.lookback, t - 1));
    if (!(previous.close <= previousHigh)) return { matched: false, failed: "rule4" };
  }

  // 5. Optional prior base: (HH_N − LL_N) / LL_N × 100 at or below the limit.
  const baseRangePercent = ((priorHigh - lowest(window)) / lowest(window)) * 100;
  if (p.maxBaseRangePercent !== null && !atMost(baseRangePercent, p.maxBaseRangePercent)) return { matched: false, failed: "rule5" };

  const breakoutPercent = (today.close / priorHigh - 1) * 100;
  return {
    matched: true,
    sortKey: breakoutPercent,
    reasons: [
      { kind: "criterion", key: "closeAboveHigh" },
      { kind: "criterion", key: "relativeVolume" },
      { kind: "criterion", key: "closeLocation" },
      ...(p.requireFirstBreak ? [{ kind: "criterion", key: "firstBreak" } as const] : []),
    ],
    metrics: [
      { key: "closeIdr", value: today.close, unit: "idr" },
      { key: "priorHighIdr", value: priorHigh, unit: "idr" },
      { key: "lookbackSessions", value: p.lookback, unit: "count" },
      { key: "breakoutPercent", value: round(breakoutPercent), unit: "percent" },
      { key: "relativeVolume", value: round(relativeVolume), unit: "ratio" },
      { key: "closeLocation", value: round(location), unit: "ratio" },
      { key: "averageValue20Idr", value: context.averageValueIdr === null ? null : Math.round(context.averageValueIdr), unit: "idr" },
      ...(p.maxBaseRangePercent !== null ? [{ key: "baseRangePercent", value: round(baseRangePercent), unit: "percent" } as const] : []),
      // Needs HAKA-25's araPrice; null (unavailable) until that module exists (§4 Exclusions).
      { key: "atUpperLimit", value: null, unit: "count" },
    ],
    notes: [
      `Closed at Rp ${plainIdr(today.close)}, above the highest price of the previous ${p.lookback} sessions (Rp ${plainIdr(priorHigh)}).`,
    ],
  };
}
