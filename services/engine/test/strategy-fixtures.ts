// A synthetic universe for the strategy scan tests (route, app contract and the Docker e2e). Invented symbols and
// prices; no provider data. At the draft's default rules (STRATEGY_RULES) on SCAN_SESSION:
//   BRKT  BREAKOUT (closes above its 20-session high on 3× volume)
//   BBRV  BB REVERSAL (closed below the lower band on t−1, back inside on t)
//   FLAT  eligible, matches nothing
//   THIN  gate G4 (average value ≈ Rp 0.5 bn)
//   SPLT  gate G8 (split ex-date inside the window)
//   NOTA  gate G7 (special notation)
//   NEWL  gate G2 (30 sessions since listing)
import { previousTradingDay } from "@/lib/freshness/session";
import { MemoryStrategyStore } from "../src/serve/strategies";
import type { SecurityFacts } from "../src/strategies/gate";
import type { Bar } from "../src/strategies/indicators";
import { STRATEGY_RULES } from "../src/strategies/rules";
import { scanUniverse, type ScanResult } from "../src/strategies/scan";

export const SCAN_SESSION = "2026-10-15";
export const FIXTURE_SESSIONS = 70;

/** The `count` IDX trading days ending at `last`, oldest first. */
export function tradingDays(last: string, count: number): string[] {
  const days = [last];
  while (days.length < count) days.unshift(previousTradingDay(days[0]));
  return days;
}

const NOISE = [0, 3, -2, 4, -1, 2, -3, 1];

/** A quiet series around `level`, then the given last rows (O/H/L/C/V) replacing the tail. */
function series(dates: string[], level: number, volume: number, tail: Array<[number, number, number, number, number]> = []): Bar[] {
  let previous = level;
  const bars = dates.map((date, index): Bar => {
    const close = level + NOISE[index % NOISE.length];
    const open = previous;
    previous = close;
    return { date, open, high: Math.max(open, close) + 5, low: Math.min(open, close) - 5, close, volume, value: null };
  });
  tail.forEach(([open, high, low, close, v], index) => {
    const at = bars.length - tail.length + index;
    bars[at] = { ...bars[at], open, high, low, close, volume: v };
  });
  return bars;
}

export function fixtureUniverse(session = SCAN_SESSION) {
  const dates = tradingDays(session, FIXTURE_SESSIONS);
  const securities: SecurityFacts[] = [
    { symbol: "BRKT", name: "Breakout Fixture Tbk", board: null, notation: null },
    { symbol: "BBRV", name: "Band Fixture Tbk", board: null, notation: null },
    { symbol: "FLAT", name: "Flat Fixture Tbk", board: null, notation: null },
    { symbol: "THIN", name: "Thin Fixture Tbk", board: null, notation: null },
    { symbol: "SPLT", name: "Split Fixture Tbk", board: null, notation: null },
    { symbol: "NOTA", name: "Notation Fixture Tbk", board: null, notation: "X" },
    { symbol: "NEWL", name: "New Listing Fixture Tbk", board: null, notation: null },
  ];
  const bars = new Map<string, Bar[]>([
    ["BRKT", series(dates, 1000, 2_000_000, [[1010, 1090, 1005, 1080, 6_000_000]])],
    ["BBRV", series(dates, 1000, 2_000_000, [[1000, 1000, 935, 940, 3_000_000], [942, 980, 940, 975, 2_500_000]])],
    ["FLAT", series(dates, 1000, 2_000_000)],
    ["THIN", series(dates, 1000, 500_000, [[1010, 1090, 1005, 1080, 1_500_000]])],
    ["SPLT", series(dates, 1000, 2_000_000, [[1010, 1090, 1005, 1080, 6_000_000]])],
    ["NOTA", series(dates, 1000, 2_000_000, [[1010, 1090, 1005, 1080, 6_000_000]])],
    ["NEWL", series(dates.slice(-30), 1000, 2_000_000, [[1010, 1090, 1005, 1080, 6_000_000]])],
  ]);
  const splitExDates = new Map<string, string[]>([["SPLT", [dates[dates.length - 10]]]]);
  return { session, dates, securities, bars, splitExDates };
}

export function fixtureScan(session = SCAN_SESSION): ScanResult {
  return scanUniverse({ ...fixtureUniverse(session), rules: STRATEGY_RULES });
}

/** The fixture scan as a stored run (what strategy-scan-eod writes), for the /v1/strategies route and contract tests. */
export function fixtureStrategyStore(asOf = new Date("2026-10-15T14:00:00Z"), session = SCAN_SESSION): MemoryStrategyStore {
  const result = fixtureScan(session);
  const id = "00000000-0000-4000-8000-000000000001";
  return new MemoryStrategyStore({
    runs: [{
      id, sessionDate: session, rulesVersion: result.rulesVersion, status: "SUCCEEDED", skipReason: null,
      covered: result.universe.covered, eligible: result.universe.eligible, skipped: result.universe.skipped,
      candidateCount: result.candidates.length, gateFailures: result.gateFailures, asOf,
    }],
    candidates: { [id]: result.candidates.map(({ strategyId, symbol, name, rank, reasons, metrics }) => ({ strategyId, symbol, name, rank, reasons, metrics })) },
  });
}
