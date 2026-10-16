import "server-only";
import { leastFresh, withFreshness, type WithFreshness } from "@/lib/freshness";
import type { ScreenerCandidate, ScreenerStrategy, StrategyBoard } from "@/lib/strategies/contract";
import type { MarketDataSource } from "@/server/market";
import { IdxBeiSource } from "@/server/market/idx-bei-source";
import { logWarn } from "@/server/log";
import { arjumScreenerSource } from "./arjum-screener";
import { engineStrategySource, type EngineStrategyClient } from "./engine-eod";
import type { StrategySource } from "./source";

/**
 * Registered strategy sources, bound to one request's market source. The arjum screener comes first, so it keeps any
 * id it shares with a later source. HAKAPRO_EOD_ENGINE (the Data Engine's scans on the HAKA-17 DRAFT rules, read over
 * the idx-bei lane at MARKET_API_URL) registers only with STRATEGY_ENGINE_ENABLED=1; it is off by default.
 * HAKAPRO_REALTIME_ENGINE waits for Running Trade (HAKA-14/15).
 */
export function strategySources(
  market: MarketDataSource,
  env: Record<string, string | undefined> = process.env,
  engineClient: () => EngineStrategyClient = () => IdxBeiSource.fromEnv(),
): StrategySource[] {
  return [arjumScreenerSource(market), ...(env.STRATEGY_ENGINE_ENABLED === "1" ? [engineStrategySource(engineClient)] : [])];
}

/**
 * Every source's strategies and candidates in one envelope: as fresh as its stalest source, as of its oldest data.
 * Only sources that contribute a strategy count, so an optional source with nothing to show (an unavailable engine)
 * doesn't mark the others' data UNAVAILABLE; with no strategies at all, every source counts.
 * A strategy id already taken by an earlier source is skipped and logged.
 */
export async function strategyBoard(sources: StrategySource[], signal?: AbortSignal): Promise<WithFreshness<StrategyBoard>> {
  const runs = await Promise.all(sources.map(async (source) => {
    const context = await source.context(signal);
    const strategies = await source.list(signal);
    const candidates = await Promise.all(strategies.map((strategy) => source.candidates(strategy.id, signal)));
    return { source, context, strategies, candidates: candidates.flat() };
  }));

  const strategies: ScreenerStrategy[] = [];
  const candidates: ScreenerCandidate[] = [];
  const owner = new Map<string, string>();
  const contributing = new Set<StrategySource>();
  for (const run of runs) {
    for (const strategy of run.strategies) {
      const taken = owner.get(strategy.id);
      if (taken) {
        logWarn("strategy_id_collision", { id: strategy.id, source: run.source.id, keptSource: taken });
        continue;
      }
      owner.set(strategy.id, run.source.id);
      contributing.add(run.source);
      strategies.push(strategy);
      candidates.push(...run.candidates.filter((candidate) => candidate.strategyId === strategy.id && candidate.source === run.source.id));
    }
  }

  const envelopes = (contributing.size ? runs.filter((run) => contributing.has(run.source)) : runs).map((run) => run.context);
  return withFreshness(
    { contexts: runs.map((run) => run.context.data), strategies, candidates },
    {
      freshness: leastFresh(envelopes.map((envelope) => envelope.freshness)),
      asOf: envelopes.map((envelope) => envelope.asOf).filter((asOf): asOf is string => asOf !== null).sort()[0] ?? null,
      source: envelopes.map((envelope) => envelope.source).join("+"),
      period: envelopes.length === 1 ? envelopes[0].period : undefined,
    },
  );
}

export type { StrategySource } from "./source";
