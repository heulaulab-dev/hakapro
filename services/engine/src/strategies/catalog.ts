// What the EOD engine runs and what it deliberately does not (STRATEGY-RULES draft §1). Labels and descriptions are
// HAKAPRO's own neutral wording (§3.5): what was observed, never what to do.
import { STRATEGY_RULES, type StrategyId, type StrategyRules } from "./rules";

export type BuiltStrategy = { id: StrategyId; label: string; description: string; section: string };

export function builtStrategies(rules: StrategyRules = STRATEGY_RULES): BuiltStrategy[] {
  const bo = rules.breakout;
  const bb = rules.bbReversal;
  return [
    {
      id: "breakout",
      label: "BREAKOUT",
      section: "§4",
      description: `Closed above the highest price of the previous ${bo.lookback} sessions on volume at least ${bo.minRelativeVolume}× its `
        + `${bo.relativeVolumeLookback}-session average, in the upper part of the day's range${bo.requireFirstBreak ? "; first such close in the window" : ""}. `
        + `Draft rules ${rules.rulesVersion}, not yet approved.`,
    },
    {
      id: "bb-reversal",
      label: "BB REVERSAL",
      section: "§5",
      description: `Closed below the lower Bollinger band (${bb.period}, ${bb.stdDevs}) within the last ${bb.pierceWindow} sessions, then closed back `
        + `inside the band, above the previous close${bb.requireBullishCandle ? " and above the open" : ""}. Draft rules ${rules.rulesVersion}, not yet approved.`,
    },
  ];
}

/** Draft strategies the engine does not build, and why (listed on /v1/meta/health). */
export const NOT_BUILT_STRATEGIES = [
  { id: "ara-hunter", label: "ARA HUNTER", section: "§9", reason: "Needs HAKA-25 (official tick sizes, auto-rejection limits and reference prices); the draft allows no approximation." },
  { id: "haka-sore", label: "HAKA SORE / BSJP", section: "§8", reason: "The EOD variant needs HAKA-25 for the upper-limit exclusion (rule 5); the live variant needs the Running Trade tape (HAKA-14/15)." },
  { id: "haka-pagi", label: "HAKA PAGI", section: "§6", reason: "Needs the morning trade tape with the aggressor side (Running Trade, HAKA-14/15) and HAKA-25; daily bars cannot show who initiated trades." },
  { id: "scalping-intraday", label: "SCALPING INTRADAY", section: "§7", reason: "The EOD pre-filter needs HAKA-25 tick sizes; the live variant needs Running Trade (HAKA-14/15)." },
] as const;
