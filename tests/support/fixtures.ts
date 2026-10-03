import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Frozen baseline dataset; value-pinned tests must never read a re-recorded dataset. */
export const BASELINE_DIR = fileURLToPath(new URL("../../fixtures/arjum-baseline", import.meta.url));

const PATHS: Record<string, string> = {
  screener: "global/screener.json",
  "market-cap": "global/market-cap.json",
  health: "global/health.json",
  search: "search/_bank.json",
  analysis: "legacy/analysis.json",
  "broker-summary": "symbols/BBCA/broker-summary.json",
  "broker-accumulation": "symbols/BBCA/broker-accumulation.json",
  history: "symbols/BBCA/history.json",
  seasonal: "symbols/BBCA/seasonal.json",
  insiders: "symbols/BBCA/insiders.json",
  "done-details": "symbols/BBCA/done-details.json",
  "financial-statements": "symbols/BBCA/financial-statements.INCOME_STATEMENT.json",
};

/** Reads a baseline recording by its logical endpoint name. */
export function fixture<T = unknown>(name: string): T {
  const path = PATHS[name];
  if (!path) throw new Error(`Unknown fixture ${name}`);
  return JSON.parse(readFileSync(`${BASELINE_DIR}/${path}`, "utf8")) as T;
}

/** Builds a Date for a wall-clock time in Asia/Jakarta (UTC+7, no DST). */
export function wib(isoLocal: string): Date {
  return new Date(`${isoLocal}+07:00`);
}
