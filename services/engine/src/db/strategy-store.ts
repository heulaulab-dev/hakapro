// Strategy scans (E4) against the engine DB: the scan's inputs from daily_prices / securities / corporate_actions, the
// write of one run (replacing an earlier run of the same session and rules version), and the read port for /v1.
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import * as t from "../../db/schema";
import type { ScanCandidateRecord, ScanRunRecord, StrategyStore } from "../serve/strategies";
import { STRATEGY_SOURCE } from "../serve/strategies";
import type { SecurityFacts } from "../strategies/gate";
import type { Bar } from "../strategies/indicators";
import { rowsToLoad, type StrategyRules } from "../strategies/rules";
import type { ScanInput, ScanResult } from "../strategies/scan";
import { addDays } from "../sources/session";
import type { EngineDb } from "./client";

/**
 * Calendar days read before the session: comfortably more than `rows` sessions (5 per 7 days plus a month of holidays).
 * A stock with long gaps inside that span simply has fewer rows and fails G2, which is the conservative outcome.
 */
export const lookbackDays = (rows: number) => Math.ceil((rows * 7) / 5) + 60;

/** The active universe with its newest `rowsToLoad(rules)` daily rows up to the session, and split ex-dates. */
export async function loadScanInput(db: EngineDb, session: string, rules: StrategyRules): Promise<ScanInput> {
  const rows = rowsToLoad(rules);
  const from = addDays(session, -lookbackDays(rows));
  const securities: SecurityFacts[] = await db.select({ symbol: t.securities.symbol, name: t.securities.name, board: t.securities.board, notation: t.securities.notation })
    .from(t.securities).where(eq(t.securities.active, true)).orderBy(asc(t.securities.symbol));
  const active = new Set(securities.map((security) => security.symbol));

  const daily = await db.select({
    symbol: t.dailyPrices.symbol, date: t.dailyPrices.date, open: t.dailyPrices.open, high: t.dailyPrices.high, low: t.dailyPrices.low,
    close: t.dailyPrices.close, volume: t.dailyPrices.volume, value: t.dailyPrices.value,
  }).from(t.dailyPrices).where(and(gte(t.dailyPrices.date, from), lte(t.dailyPrices.date, session))).orderBy(asc(t.dailyPrices.symbol), asc(t.dailyPrices.date));
  const bars = new Map<string, Bar[]>();
  for (const { symbol, ...bar } of daily) {
    if (!active.has(symbol)) continue;
    const list = bars.get(symbol) ?? [];
    list.push(bar);
    bars.set(symbol, list);
  }
  for (const [symbol, list] of bars) if (list.length > rows) bars.set(symbol, list.slice(-rows));

  const splits = await db.select({ symbol: t.corporateActions.symbol, exDate: t.corporateActions.exDate }).from(t.corporateActions)
    .where(and(eq(t.corporateActions.type, "SPLIT"), gte(t.corporateActions.exDate, from), lte(t.corporateActions.exDate, session)));
  const splitExDates = new Map<string, string[]>();
  for (const split of splits) if (split.exDate) splitExDates.set(split.symbol, [...(splitExDates.get(split.symbol) ?? []), split.exDate]);

  return { session, securities, bars, splitExDates, rules };
}

const runBase = (rules: StrategyRules, session: string, asOf: Date, jobRunId: string | null) => ({
  sessionDate: session, rulesVersion: rules.rulesVersion, parameters: JSON.parse(JSON.stringify(rules)) as Record<string, unknown>,
  jobRunId, source: STRATEGY_SOURCE, asOf,
});

/** Stores a finished scan, replacing any earlier run (and its candidates) of the same session and rules version. */
export async function saveScanRun(db: EngineDb, result: ScanResult, meta: { rules: StrategyRules; asOf: Date; jobRunId: string | null }): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.delete(t.scanRuns).where(and(eq(t.scanRuns.sessionDate, result.session), eq(t.scanRuns.rulesVersion, result.rulesVersion)));
    const [run] = await tx.insert(t.scanRuns).values({
      ...runBase(meta.rules, result.session, meta.asOf, meta.jobRunId), status: "SUCCEEDED",
      covered: result.universe.covered, eligible: result.universe.eligible, skipped: result.universe.skipped,
      gateFailures: result.gateFailures, misses: result.misses, candidateCount: result.candidates.length,
    }).returning({ id: t.scanRuns.id });
    for (let i = 0; i < result.candidates.length; i += 500) {
      await tx.insert(t.scanCandidates).values(result.candidates.slice(i, i + 500).map((candidate) => ({
        runId: run.id, strategyId: candidate.strategyId, symbol: candidate.symbol, sessionDate: result.session, rulesVersion: result.rulesVersion,
        rank: candidate.rank, name: candidate.name, reasons: candidate.reasons, metrics: candidate.metrics, source: STRATEGY_SOURCE, asOf: meta.asOf,
      })));
    }
    return run.id;
  });
}

/** Records why a session was not scanned; never replaces a run that already exists for it. */
export async function saveSkippedRun(db: EngineDb, session: string, reason: string, meta: { rules: StrategyRules; asOf: Date; jobRunId: string | null }): Promise<void> {
  await db.insert(t.scanRuns).values({ ...runBase(meta.rules, session, meta.asOf, meta.jobRunId), status: "SKIPPED", skipReason: reason }).onConflictDoNothing();
}

/** True when a SUCCEEDED run exists for the session and rules version. */
export async function hasSucceededRun(db: EngineDb, session: string, rulesVersion: string): Promise<boolean> {
  const [row] = await db.select({ id: t.scanRuns.id }).from(t.scanRuns)
    .where(and(eq(t.scanRuns.sessionDate, session), eq(t.scanRuns.rulesVersion, rulesVersion), eq(t.scanRuns.status, "SUCCEEDED"))).limit(1);
  return Boolean(row);
}

const runColumns = {
  id: t.scanRuns.id, sessionDate: t.scanRuns.sessionDate, rulesVersion: t.scanRuns.rulesVersion, status: t.scanRuns.status, skipReason: t.scanRuns.skipReason,
  covered: t.scanRuns.covered, eligible: t.scanRuns.eligible, skipped: t.scanRuns.skipped, candidateCount: t.scanRuns.candidateCount,
  gateFailures: t.scanRuns.gateFailures, asOf: t.scanRuns.asOf,
};

export class DbStrategyStore implements StrategyStore {
  constructor(private readonly db: EngineDb) {}

  async latestRun(rulesVersion: string): Promise<ScanRunRecord | null> {
    const [row] = await this.db.select(runColumns).from(t.scanRuns)
      .where(and(eq(t.scanRuns.status, "SUCCEEDED"), eq(t.scanRuns.rulesVersion, rulesVersion))).orderBy(desc(t.scanRuns.sessionDate)).limit(1);
    return row ?? null;
  }

  async candidates(runId: string): Promise<ScanCandidateRecord[]> {
    return this.db.select({
      strategyId: t.scanCandidates.strategyId, symbol: t.scanCandidates.symbol, name: t.scanCandidates.name, rank: t.scanCandidates.rank,
      reasons: t.scanCandidates.reasons, metrics: t.scanCandidates.metrics,
    }).from(t.scanCandidates).where(eq(t.scanCandidates.runId, runId)).orderBy(asc(t.scanCandidates.strategyId), asc(t.scanCandidates.rank));
  }

  async recentRuns(limit: number): Promise<ScanRunRecord[]> {
    return this.db.select(runColumns).from(t.scanRuns).orderBy(desc(t.scanRuns.sessionDate), desc(t.scanRuns.asOf)).limit(limit);
  }
}
