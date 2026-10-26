/**
 * Signal confluence radar and the KSEI "corporate holders up, price flat" view: every threshold in one versioned
 * object. The Data Engine evaluates these (services/engine/src/serve/radar.ts), echoes the version in each response,
 * and the methodology page renders the same object, so the documentation cannot drift from the code.
 *
 * DRAFT: no value below has been backtested. They are hypotheses chosen to describe unusual activity, not to
 * predict returns, which is why the radar counts signals and never turns them into a score (Research Brief spec
 * §3.5). Changing any value means a new version string.
 *
 * Units: `fraction` values are shares of one (0.05 = 5 %), `ratio` values are multiples (2 = twice the baseline),
 * `count` values are whole numbers.
 */

export const RADAR_SIGNAL_KEYS = [
  "foreignNetBuy5", "foreignNetBuy20", "volumeSpike", "closeAboveAverage", "priceUp5", "orderSizeSpike", "kseiHolderIncrease",
] as const;
export type RadarSignalKey = (typeof RADAR_SIGNAL_KEYS)[number];

export const RADAR_COUNTER_KEYS = ["priceVsForeign5", "priceVsForeign20", "volumeOnDownSession", "kseiHolderDecrease"] as const;
export type RadarCounterKey = (typeof RADAR_COUNTER_KEYS)[number];

export type RadarUnit = "fraction" | "ratio" | "count";
/** Which stored rows a signal reads; the methodology page explains each source and its delay. */
export type RadarInput = "dailyPrices" | "foreignFlow" | "frequency" | "kseiUpload";

export type RadarSignalRule = {
  /** Trading sessions in the observed window; null for the monthly KSEI list. */
  window: number | null;
  /** Sessions before the newest one that form the baseline average; null when there is no baseline. */
  baseline: number | null;
  /** The signal fires when the observed value is at or above this. */
  threshold: number;
  unit: RadarUnit;
  inputs: readonly RadarInput[];
};

export const RADAR_RULES_V0 = {
  version: "radar-v0.1-draft",
  /** No backtest yet: the radar lists observations and counts them, it never scores or ranks by an outcome. */
  backtested: false,
  signals: {
    /** Net foreign shares (buy − sell) over the newest 5 sessions, as a share of those sessions' total volume. */
    foreignNetBuy5: { window: 5, baseline: null, threshold: 0.05, unit: "fraction", inputs: ["foreignFlow", "dailyPrices"] },
    /** The same over the newest 20 sessions. */
    foreignNetBuy20: { window: 20, baseline: null, threshold: 0.03, unit: "fraction", inputs: ["foreignFlow", "dailyPrices"] },
    /** Newest session volume ÷ the mean volume of the 20 sessions before it. */
    volumeSpike: { window: 1, baseline: 20, threshold: 2, unit: "ratio", inputs: ["dailyPrices"] },
    /** Newest close ÷ the mean close of the 20 sessions ending at it, minus one. */
    closeAboveAverage: { window: 1, baseline: 20, threshold: 0.02, unit: "fraction", inputs: ["dailyPrices"] },
    /** Close change from the session before the window to the newest session, over 5 sessions. */
    priceUp5: { window: 5, baseline: null, threshold: 0.05, unit: "fraction", inputs: ["dailyPrices"] },
    /** Newest value per trade (value ÷ frequency) ÷ the mean value per trade of the 20 sessions before it. */
    orderSizeSpike: { window: 1, baseline: 20, threshold: 2, unit: "ratio", inputs: ["dailyPrices", "frequency"] },
    /** ≥1% holders whose shares increased in the newest uploaded KSEI month (month over month). */
    kseiHolderIncrease: { window: null, baseline: null, threshold: 1, unit: "count", inputs: ["kseiUpload"] },
  } satisfies Record<RadarSignalKey, RadarSignalRule>,
  /**
   * Counter-evidence is listed whenever it is observed, whatever fired:
   * - priceVsForeign5/20: price direction and net foreign flow disagree over the same sessions (both non-zero);
   * - volumeOnDownSession: the volume spike threshold is met on a session that closed lower;
   * - kseiHolderDecrease: at least this many ≥1% holders decreased their shares in the newest uploaded month.
   */
  counter: {
    priceVsForeign5: { window: 5 },
    priceVsForeign20: { window: 20 },
    volumeOnDownSession: { window: 1 },
    kseiHolderDecrease: { threshold: 1 },
  } satisfies Record<RadarCounterKey, { window?: number; threshold?: number }>,
  /** Stocks with at least one firing signal are listed, most firing signals first, then by traded value; capped. */
  listLimit: 300,
} as const;

/** The rules' shape: the v0 signal set, with a version and list cap any later version may change. */
export type RadarRules = Omit<typeof RADAR_RULES_V0, "version" | "listLimit"> & { version: string; listLimit: number };

/**
 * KSEI view: corporate (KSEI investor type CP) ≥1% holders whose combined shares rose month over month while the
 * stock's close moved at most `maxPriceChange` (a fraction, so 0.01 = +1 %) between the two position dates.
 * A description of two data sets side by side, not a conclusion about intent.
 */
export const STEALTH_RULES_V0 = {
  version: "ksei-corporate-v0.1-draft",
  backtested: false,
  investorTypes: ["CP"],
  /** "Flat or lower": a close change at or below this between the previous and the newest position date. */
  maxPriceChange: 0.01,
  /** A stored close more than this many calendar days before a position date is not used for it (price missing instead). */
  maxCloseGapDays: 10,
  listLimit: 200,
} as const;

export type StealthRules = Omit<typeof STEALTH_RULES_V0, "version" | "maxPriceChange" | "maxCloseGapDays" | "listLimit"> & {
  version: string; maxPriceChange: number; maxCloseGapDays: number; listLimit: number;
};
