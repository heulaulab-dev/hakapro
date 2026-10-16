import "server-only";
import { withFreshness, type WithFreshness } from "@/lib/freshness";
import type { ScreenerCandidate, ScreenerContext, ScreenerStrategy, StrategyBoard } from "@/lib/strategies/contract";
import { logWarn } from "@/server/log";
import { MarketDataError } from "@/server/market/errors";
import type { StrategySource } from "./source";

const SOURCE = "HAKAPRO_EOD_ENGINE";
/** Engine ids (`breakout`, `bb-reversal`) are prefixed so they can never collide with a provider strategy's slug. */
export const ENGINE_STRATEGY_PREFIX = "eod-";

/** What the adapter needs from the idx-bei lane client (IdxBeiSource#engineStrategies, the Data Engine's `/v1/strategies`). */
export type EngineStrategyClient = { engineStrategies(): Promise<WithFreshness<StrategyBoard>> };

const emptyContext: ScreenerContext = { source: SOURCE, version: null, marketCondition: null, universe: null };

/**
 * The Data Engine's board → this source's part of the HAKA-18 contract. Only HAKAPRO_EOD_ENGINE entries are kept;
 * ids are prefixed; freshness and data date come from the lane's envelope (re-derived by the app's session clock).
 * The engine already sets score null and words reasons as criteria and notes (draft rules, HAKA-17).
 */
export function fromEngineBoard({ data: board, freshness, asOf }: WithFreshness<StrategyBoard>): {
  context: ScreenerContext; strategies: ScreenerStrategy[]; candidates: ScreenerCandidate[];
} {
  const strategies = board.strategies.filter((strategy) => strategy.source === SOURCE);
  const ids = new Set(strategies.map((strategy) => strategy.id));
  return {
    context: board.contexts.find((context) => context.source === SOURCE) ?? emptyContext,
    strategies: strategies.map((strategy) => ({ ...strategy, id: `${ENGINE_STRATEGY_PREFIX}${strategy.id}`, dataAsOf: asOf ?? strategy.dataAsOf, freshness })),
    candidates: board.candidates
      .filter((candidate) => candidate.source === SOURCE && ids.has(candidate.strategyId))
      .map((candidate) => ({ ...candidate, strategyId: `${ENGINE_STRATEGY_PREFIX}${candidate.strategyId}`, dataAsOf: asOf ?? candidate.dataAsOf, freshness, score: null })),
  };
}

/**
 * The Data Engine's EOD strategy scans as a strategy source (registered only with STRATEGY_ENGINE_ENABLED=1). One
 * instance reads `/v1/strategies` at most once. An engine that is unconfigured, unreachable or rate limited contributes
 * no strategies and an UNAVAILABLE context (logged), so the other sources' strategies are still served.
 */
export function engineStrategySource(client: () => EngineStrategyClient): StrategySource {
  type Run = { envelope: WithFreshness<unknown> } & ReturnType<typeof fromEngineBoard>;
  let run: Promise<Run> | null = null;
  const load = () => (run ??= (async (): Promise<Run> => {
    try {
      const envelope = await client().engineStrategies();
      return { envelope, ...fromEngineBoard(envelope) };
    } catch (error) {
      logWarn("strategy_engine_unavailable", { code: error instanceof MarketDataError ? error.code : "UNKNOWN" });
      return { envelope: withFreshness(null, { freshness: "UNAVAILABLE", asOf: null, source: "idx-bei" }), context: emptyContext, strategies: [], candidates: [] };
    }
  })());
  return {
    id: SOURCE,
    async context() {
      const { envelope, context } = await load();
      return { ...envelope, data: context };
    },
    async list() {
      return (await load()).strategies;
    },
    async candidates(strategyId) {
      return (await load()).candidates.filter((candidate) => candidate.strategyId === strategyId);
    },
  };
}
