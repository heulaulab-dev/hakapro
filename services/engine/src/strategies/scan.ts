// One EOD scan over the whole stored universe: gate G, then every built strategy, sorted per the draft (§3.2: each
// strategy's sort key, then symbol ascending). Pure: same rows, rules and session give the same result.
import type { Metric, Reason } from "@/lib/strategies/contract";
import { evaluateBbReversal } from "./bb-reversal";
import { evaluateBreakout, type RuleOutcome } from "./breakout";
import { evaluateGate, GATE_RULES, type GateRule, type SecurityFacts } from "./gate";
import type { Bar } from "./indicators";
import { rowsUsed, STRATEGY_IDS, type StrategyId, type StrategyRules } from "./rules";
import { BOARD_UNKNOWN_NOTE, DRAFT_NOTE, VALUE_ESTIMATED_NOTE } from "./wording";

export type ScanInput = {
  session: string;
  securities: SecurityFacts[];
  /** Daily rows per symbol up to the session, oldest first. */
  bars: Map<string, Bar[]>;
  /** Stored split ex-dates per symbol. */
  splitExDates: Map<string, string[]>;
  rules: StrategyRules;
};

export type ScanCandidate = {
  strategyId: StrategyId;
  symbol: string;
  name: string | null;
  /** 0-based position in the strategy's sort order. */
  rank: number;
  reasons: Reason[];
  metrics: Metric[];
};

export type ScanResult = {
  session: string;
  rulesVersion: string;
  /** covered = securities scanned; eligible = passed gate G; skipped = failed it. */
  universe: { covered: number; eligible: number; skipped: number };
  gateFailures: Record<GateRule, number>;
  /** Eligible symbols each strategy did not list, by the first rule that failed. */
  misses: Record<StrategyId, Record<string, number>>;
  /** Rows that failed G6, for the strategy_bad_row log. */
  badRows: Array<{ symbol: string; detail: string }>;
  candidates: ScanCandidate[];
};

/** Sort direction of each strategy's key: BREAKOUT by breakoutPercent desc, BB REVERSAL by percentB asc. */
const DESCENDING: Record<StrategyId, boolean> = { breakout: true, "bb-reversal": false };

export function scanUniverse(input: ScanInput): ScanResult {
  const { rules } = input;
  const used = rowsUsed(rules);
  const gateFailures = Object.fromEntries(GATE_RULES.map((rule) => [rule, 0])) as Record<GateRule, number>;
  const misses = Object.fromEntries(STRATEGY_IDS.map((id) => [id, {}])) as Record<StrategyId, Record<string, number>>;
  const badRows: ScanResult["badRows"] = [];
  const found: Record<StrategyId, Array<{ symbol: string; name: string | null; sortKey: number; reasons: Reason[]; metrics: Metric[] }>> = { breakout: [], "bb-reversal": [] };
  let eligible = 0;

  const securities = [...input.securities].sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  for (const security of securities) {
    const gate = evaluateGate({
      session: input.session, bars: input.bars.get(security.symbol) ?? [], security,
      splitExDates: input.splitExDates.get(security.symbol) ?? [], rowsUsed: used,
    }, rules.gate);
    if (!gate.ok) {
      gateFailures[gate.rule] += 1;
      if (gate.rule === "G6") badRows.push({ symbol: security.symbol, detail: gate.detail });
      continue;
    }
    eligible += 1;
    const common = {
      metrics: [{ key: "boardKnown", value: gate.boardKnown ? 1 : 0, unit: "count" } satisfies Metric],
      notes: [...(gate.boardKnown ? [] : [BOARD_UNKNOWN_NOTE]), ...(gate.valueEstimatedSessions > 0 ? [VALUE_ESTIMATED_NOTE] : []), DRAFT_NOTE],
    };
    const outcomes: Record<StrategyId, RuleOutcome> = {
      breakout: evaluateBreakout(gate.bars, rules.breakout, { averageValueIdr: gate.averageValueIdr }),
      "bb-reversal": evaluateBbReversal(gate.bars, rules.bbReversal),
    };
    for (const id of STRATEGY_IDS) {
      const outcome = outcomes[id];
      if (!outcome.matched) {
        misses[id][outcome.failed] = (misses[id][outcome.failed] ?? 0) + 1;
        continue;
      }
      found[id].push({
        symbol: security.symbol, name: security.name, sortKey: outcome.sortKey,
        reasons: [...outcome.reasons, ...[...outcome.notes, ...common.notes].map((text) => ({ kind: "note", text }) as const)],
        metrics: [...outcome.metrics, ...common.metrics],
      });
    }
  }

  const candidates = STRATEGY_IDS.flatMap((id) => found[id]
    .sort((a, b) => (a.sortKey === b.sortKey ? (a.symbol < b.symbol ? -1 : 1) : DESCENDING[id] ? b.sortKey - a.sortKey : a.sortKey - b.sortKey))
    .map(({ sortKey: _sortKey, ...candidate }, rank) => ({ strategyId: id, rank, ...candidate })));

  return {
    session: input.session, rulesVersion: rules.rulesVersion,
    universe: { covered: securities.length, eligible, skipped: securities.length - eligible },
    gateFailures, misses, badRows, candidates,
  };
}
