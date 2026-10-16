// Common eligibility gate G (STRATEGY-RULES draft §3.3). Gate failures are not candidates; the scan counts them per rule.
import { before, mean, valueOf, volumeOf, type Bar, type CheckedBar } from "./indicators";
import type { GateParams } from "./rules";

export const GATE_RULES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"] as const;
export type GateRule = (typeof GATE_RULES)[number];

/** What the engine knows about a listed stock. Board and notation are null when no source reports them (all of them today). */
export type SecurityFacts = { symbol: string; name: string | null; board: string | null; notation: string | null };

export type GateInput = {
  /** The evaluation session t. */
  session: string;
  /** Stored daily rows up to t, oldest first. */
  bars: Bar[];
  security: SecurityFacts;
  /** Stored split / reverse-split ex-dates of the symbol (Yahoo events). Rights and bonus issues have no source yet. */
  splitExDates: string[];
  /** How many of the newest rows the rules read (G6 and G8 apply to them). */
  rowsUsed: number;
};

export type GatePass = {
  ok: true;
  /** The rows the rules read, OHLC-checked, oldest first; the last one is t. */
  bars: CheckedBar[];
  /** False while no source reports board and notation: the stock was not checked against G7's boards (Q-G4). */
  boardKnown: boolean;
  /** avgVal over the liquidity window (G4), IDR. */
  averageValueIdr: number | null;
  /** Sessions in that window whose value is the close × volume proxy. */
  valueEstimatedSessions: number;
};
export type GateFail = { ok: false; rule: GateRule; detail: string };

/** Watchlist board (Papan Pemantauan Khusus, incl. full call auction) and the acceleration board: excluded by G7. */
const EXCLUDED_BOARD = /pemantauan|watch|akselerasi|acceleration/i;
const hasNotation = (notation: string | null) => notation !== null && notation.trim() !== "" && notation.trim() !== "-";

const consistent = (bar: Bar): bar is CheckedBar =>
  bar.open !== null && bar.high !== null && bar.low !== null && bar.close > 0
  && bar.low <= Math.min(bar.open, bar.close) && Math.max(bar.open, bar.close) <= bar.high;

/** Applies G1–G8 in the draft's order; the first failing rule is reported. */
export function evaluateGate(input: GateInput, p: GateParams): GatePass | GateFail {
  const { bars, session, security } = input;
  const t = bars.at(-1);

  // G1: a row for t with V > 0. No row (suspension, no trade or stale data) is the observable proxy.
  if (!t || t.date !== session) return { ok: false, rule: "G1", detail: t ? `latest row ${t.date}` : "no rows" };
  if (volumeOf(t) <= 0) return { ok: false, rule: "G1", detail: "no volume on t" };

  // G2: history (and IPO lookback) as the stored row count.
  if (bars.length < p.minHistory) return { ok: false, rule: "G2", detail: `${bars.length} of ${p.minHistory} sessions` };

  // G3: traded on at least minTradedSessions of the tradedLookback sessions before t.
  if (p.minTradedSessions > 0) {
    const traded = before(bars, p.tradedLookback).filter((bar) => volumeOf(bar) > 0).length;
    if (traded < p.minTradedSessions) return { ok: false, rule: "G3", detail: `traded ${traded} of ${p.tradedLookback}` };
  }

  // G4: average value over the liquidity window before t.
  const window = p.liquidityLookback > 0 ? before(bars, p.liquidityLookback) : [];
  const averageValueIdr = window.length ? mean(window.map(valueOf)) : null;
  const valueEstimatedSessions = window.filter((bar) => bar.value === null).length;
  if (p.minAverageValueIdr > 0 && (averageValueIdr === null || averageValueIdr < p.minAverageValueIdr)) {
    return { ok: false, rule: "G4", detail: `average value ${averageValueIdr === null ? "n/a" : Math.round(averageValueIdr)}` };
  }

  // G5: minimum price on t.
  if (t.close < p.minPriceIdr) return { ok: false, rule: "G5", detail: `close ${t.close}` };

  // G6: consistent OHLC on every row the rules read. A bad row skips the symbol; it is never guessed.
  const used = bars.slice(-input.rowsUsed);
  const bad = used.find((bar) => !consistent(bar));
  if (bad) return { ok: false, rule: "G6", detail: `inconsistent row ${bad.date}` };

  // G7: watchlist board, special notation and acceleration board. Unknown is carried as boardKnown: false, never
  // silently treated as the main board (Q-G4); no current source reports notation.
  if (hasNotation(security.notation)) return { ok: false, rule: "G7", detail: "special notation" };
  if (security.board !== null && EXCLUDED_BOARD.test(security.board)) return { ok: false, rule: "G7", detail: `board ${security.board}` };
  const boardKnown = security.board !== null && security.notation !== null;

  // G8: a split ex-date inside the rows used would distort unadjusted highs and bands (Q-G5).
  if (p.excludeCorporateActions && used.length) {
    const first = used[0].date;
    const exDate = input.splitExDates.find((date) => date > first && date <= session);
    if (exDate) return { ok: false, rule: "G8", detail: `split ex-date ${exDate}` };
  }

  return { ok: true, bars: used as CheckedBar[], boardKnown, averageValueIdr, valueEstimatedSessions };
}
