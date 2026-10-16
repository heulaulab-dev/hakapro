// HAKA-17 strategy rules, DRAFT v0.1 (docs/features/STRATEGY-RULES.md on branch docs/strategy-rules, PR #4).
// Not owner-approved: every value below is the draft's proposed default, kept in one versioned object so a stored
// result can always be explained by the rules that produced it (§3.2). Changing any value means a new rulesVersion.
//
// Only the EOD-feasible strategies are built (E4): BREAKOUT (§4) and BB REVERSAL (§5), behind the common gate G (§3.3).
// ARA HUNTER, HAKA SORE/BSJP, HAKA PAGI and SCALPING INTRADAY need HAKA-25 (tick/price-limit rules) or the Running
// Trade tape (HAKA-14/15) and are listed as not built (catalog.ts).

/** Common eligibility gate G (§3.3). G1 (traded on t) and G6 (consistent OHLC) have no parameters. */
export type GateParams = {
  /** G2: sessions of history required (also the IPO lookback), counted as stored daily rows up to t. 0 = off. */
  minHistory: number;
  /** G3: window (sessions before t) and how many of them must have V > 0. minTradedSessions 0 = off. */
  tradedLookback: number;
  minTradedSessions: number;
  /** G4: avgVal over the `liquidityLookback` sessions before t must reach `minAverageValueIdr`. 0 = off. */
  liquidityLookback: number;
  minAverageValueIdr: number;
  /** G5: minimum close on t, IDR. 0 = off. */
  minPriceIdr: number;
  /** G8: skip a symbol with a stored split / reverse-split ex-date inside the rows used. */
  excludeCorporateActions: boolean;
};

/** BREAKOUT (§4). */
export type BreakoutParams = {
  /** N: HH_N = max(H[t−N..t−1]). */
  lookback: number;
  /** RVOL = V[t] / mean(V[t−n..t−1]); the draft's default is the 20-session average. */
  relativeVolumeLookback: number;
  minRelativeVolume: number;
  minCloseLocation: number;
  requireFirstBreak: boolean;
  /** Prior range (HH_N − LL_N) / LL_N × 100 must be at or below this; null = disabled (Q-BO2). */
  maxBaseRangePercent: number | null;
};

/** BB REVERSAL (§5). */
export type BbReversalParams = {
  period: number;
  /** k, in population standard deviations (Q-BB4). */
  stdDevs: number;
  /** W: the pierce must be in [t−W, t−1]. */
  pierceWindow: number;
  pierceBasis: "close" | "low";
  minBandwidthPercent: number;
  requireBullishCandle: boolean;
};

export type StrategyRules = {
  rulesVersion: string;
  gate: GateParams;
  breakout: BreakoutParams;
  bbReversal: BbReversalParams;
};

export const RULES_VERSION = "0.1-draft";

const freeze = <T extends object>(value: T): Readonly<T> => {
  for (const nested of Object.values(value)) if (nested && typeof nested === "object") Object.freeze(nested);
  return Object.freeze(value);
};

/** The draft's defaults (§3.3, §4, §5), unchanged. */
export const STRATEGY_RULES: Readonly<StrategyRules> = freeze({
  rulesVersion: RULES_VERSION,
  gate: {
    minHistory: 60,
    tradedLookback: 20,
    minTradedSessions: 18,
    liquidityLookback: 20,
    minAverageValueIdr: 1_000_000_000,
    minPriceIdr: 100,
    excludeCorporateActions: true,
  },
  breakout: {
    lookback: 20,
    relativeVolumeLookback: 20,
    minRelativeVolume: 2.0,
    minCloseLocation: 0.5,
    requireFirstBreak: true,
    maxBaseRangePercent: null,
  },
  bbReversal: {
    period: 20,
    stdDevs: 2.0,
    pierceWindow: 3,
    pierceBasis: "close",
    minBandwidthPercent: 4.0,
    requireBullishCandle: true,
  },
});

/** Engine strategy ids (the draft's `strategyId`, §3.5). The app prefixes them (`eod-breakout`) to stay collision-free. */
export const STRATEGY_IDS = ["breakout", "bb-reversal"] as const;
export type StrategyId = (typeof STRATEGY_IDS)[number];

/** Daily rows a strategy reads, per the draft's "Inputs" lines. */
export function breakoutInputRows(p: BreakoutParams): number {
  // ≥ N + 2 (§4 Inputs): t, t−1 and the N sessions before t−1 for the first-break check; RVOL needs its own window.
  return Math.max(p.lookback + 2, p.relativeVolumeLookback + 1);
}

export function bbReversalInputRows(p: BbReversalParams): number {
  // ≥ period + window + 1 (§5 Inputs). The bands at t−W already need only period + W rows; the draft's "+ 1" is kept.
  return p.period + p.pierceWindow + 1;
}

/** Rows the gate's windows read (t plus the lookbacks before it). */
export function gateInputRows(p: GateParams): number {
  return Math.max(p.tradedLookback, p.liquidityLookback) + 1;
}

/** Rows a scan loads per symbol: enough for G2 and for every row any rule uses. */
export function rowsToLoad(rules: StrategyRules): number {
  return Math.max(rules.gate.minHistory, gateInputRows(rules.gate), breakoutInputRows(rules.breakout), bbReversalInputRows(rules.bbReversal));
}

/** Rows G6 checks: every row an indicator actually reads. */
export function rowsUsed(rules: StrategyRules): number {
  return Math.max(gateInputRows(rules.gate), breakoutInputRows(rules.breakout), bbReversalInputRows(rules.bbReversal));
}
