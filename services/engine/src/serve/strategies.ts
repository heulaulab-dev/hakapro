// `/v1/strategies`: the latest strategy scan as a HAKA-18 board (src/lib/strategies/contract.ts), and the scan status
// for /v1/meta/health. Pure over a StrategyStore; the HTTP layer validates the board with `strategyBoardSchema`.
import type { z } from "zod";
import { classifySessionDate } from "@/lib/freshness/session";
import type { strategyBoardSchema } from "@/lib/strategies/contract";
import { builtStrategies, NOT_BUILT_STRATEGIES } from "../strategies/catalog";
import { STRATEGY_IDS, type StrategyRules } from "../strategies/rules";
import type { Served } from "./market";

export const STRATEGY_SOURCE = "HAKAPRO_EOD_ENGINE";

export type ScanRunRecord = {
  id: string;
  sessionDate: string;
  rulesVersion: string;
  status: "SUCCEEDED" | "SKIPPED";
  skipReason: string | null;
  covered: number;
  eligible: number;
  skipped: number;
  candidateCount: number;
  gateFailures: Record<string, number>;
  asOf: Date;
};

export type ScanCandidateRecord = {
  strategyId: string;
  symbol: string;
  name: string | null;
  rank: number;
  reasons: Array<Record<string, unknown>>;
  metrics: Array<{ key: string; value: number | null; unit: string }>;
};

export interface StrategyStore {
  /** The newest SUCCEEDED run for a rules version, by session date. */
  latestRun(rulesVersion: string): Promise<ScanRunRecord | null>;
  candidates(runId: string): Promise<ScanCandidateRecord[]>;
  /** Newest runs of any status and version, newest session first (health). */
  recentRuns(limit: number): Promise<ScanRunRecord[]>;
}

/** In-memory store for unit and contract tests. */
export class MemoryStrategyStore implements StrategyStore {
  constructor(private readonly data: { runs: ScanRunRecord[]; candidates: Record<string, ScanCandidateRecord[]> } = { runs: [], candidates: {} }) {}

  async latestRun(rulesVersion: string) {
    return this.data.runs.filter((run) => run.status === "SUCCEEDED" && run.rulesVersion === rulesVersion)
      .sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : -1))[0] ?? null;
  }

  async candidates(runId: string) {
    return this.data.candidates[runId] ?? [];
  }

  async recentRuns(limit: number) {
    return [...this.data.runs].sort((a, b) => (a.sessionDate < b.sessionDate ? 1 : -1)).slice(0, limit);
  }
}

export type StrategyBoardInput = z.input<typeof strategyBoardSchema>;

export const EMPTY_BOARD: StrategyBoardInput = { contexts: [], strategies: [], candidates: [] };

/** The latest run of the current rules version as a board; null (→ the empty UNAVAILABLE form) before the first run. */
export async function serveStrategies(store: StrategyStore, rules: StrategyRules, now: Date): Promise<Served<StrategyBoardInput> | null> {
  const run = await store.latestRun(rules.rulesVersion);
  if (!run) return null;
  const freshness = classifySessionDate(run.sessionDate, now);
  const order = new Map<string, number>(STRATEGY_IDS.map((id, index) => [id, index]));
  const records = (await store.candidates(run.id))
    .filter((record) => order.has(record.strategyId))
    .sort((a, b) => order.get(a.strategyId)! - order.get(b.strategyId)! || a.rank - b.rank);
  const detectedAt = run.asOf.toISOString();
  return {
    dataAsOf: run.sessionDate,
    freshness,
    data: {
      contexts: [{
        source: STRATEGY_SOURCE, version: run.rulesVersion, marketCondition: null,
        universe: { covered: run.covered, liquid: run.eligible, skipped: run.skipped },
      }],
      strategies: builtStrategies(rules).map((strategy) => ({
        id: strategy.id, label: strategy.label, description: strategy.description, source: STRATEGY_SOURCE, kind: "EOD" as const,
        dataAsOf: run.sessionDate, freshness,
      })),
      candidates: records.map((record) => ({
        symbol: record.symbol, name: record.name, strategyId: record.strategyId, detectedAt, dataAsOf: run.sessionDate, freshness,
        score: null, source: STRATEGY_SOURCE,
        // Stored as the contract shapes; the HTTP layer's strategyBoardSchema parse rejects anything else.
        reasons: record.reasons as StrategyBoardInput["candidates"][number]["reasons"],
        metrics: record.metrics as StrategyBoardInput["candidates"][number]["metrics"],
      })),
    },
  };
}

/** The `/v1/meta/health` block: whether scans are on, which draft rules, what is and is not built, the latest runs. */
export async function strategyScanHealth(enabled: boolean, store: StrategyStore | null, rules: StrategyRules) {
  const runs = store ? await store.recentRuns(5) : [];
  return {
    enabled,
    flag: "ENGINE_STRATEGY_SCANS_ENABLED",
    rulesVersion: rules.rulesVersion,
    rulesStatus: "DRAFT_NOT_APPROVED",
    built: builtStrategies(rules).map(({ id, label, section }) => ({ id, label, section, status: "BUILT" })),
    notBuilt: NOT_BUILT_STRATEGIES.map((strategy) => ({ ...strategy, status: "NOT_BUILT" })),
    runs: runs.map((run) => ({
      sessionDate: run.sessionDate, rulesVersion: run.rulesVersion, status: run.status, skipReason: run.skipReason,
      covered: run.covered, eligible: run.eligible, skipped: run.skipped, candidates: run.candidateCount,
      gateFailures: run.gateFailures, computedAt: run.asOf.toISOString(),
    })),
  };
}
