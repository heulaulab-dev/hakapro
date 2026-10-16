// Engine-side wording for strategy output (MIGRATION §9 item 5 / "§9.5", STRATEGY-RULES draft §3.5): reasons, notes
// and labels describe what was observed in data up to dataAsOf. Never advice, direction or outcome language.
import { RULES_VERSION } from "./rules";

/** IDR with en grouping and at most two decimals (notes are English; the app words criteria in en/id itself). */
export function plainIdr(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export const DRAFT_NOTE = `Draft rules ${RULES_VERSION} (HAKA-17), not yet approved by the owner.`;
export const BOARD_UNKNOWN_NOTE = "Board and special notation are not reported by any current source; not checked against the watchlist or acceleration board.";
export const VALUE_ESTIMATED_NOTE = "Average traded value is partly estimated as close × volume.";

/**
 * Words that must never appear in engine labels, descriptions or notes: recommendations, forward-looking claims and
 * performance statistics. Tests run every produced string through this list.
 */
export const FORBIDDEN_WORDING = [
  /\bbuy\b/i, /\bsell\b/i, /\bentry\b/i, /\btarget/i, /\bsignal/i, /\bpotensi\b/i, /win ?rate/i, /drawdown/i,
  /expected return/i, /\bbeli\b/i, /\bjual\b/i, /\bprofit/i, /\bupside\b/i, /[↑↓⬆⬇]/u,
];

export function forbiddenWordingIn(text: string): RegExp | null {
  return FORBIDDEN_WORDING.find((pattern) => pattern.test(text)) ?? null;
}
