import "server-only";
import { leastFresh, withFreshness, type WithFreshness } from "@/lib/freshness";
import type { ScreenerCandidate, ScreenerStrategy, StrategyBoard } from "@/lib/strategies/contract";
import type { MarketDataSource } from "@/server/market";
import { logWarn } from "@/server/log";
import { arjumScreenerSource } from "./arjum-screener";
import type { StrategySource } from "./source";

/**
 * Registered strategy sources, bound to one request's market source. HAKAPRO_EOD_ENGINE and
 * HAKAPRO_REALTIME_ENGINE register here once their rules are defined (HAKA-17).
 */
export function strategySources(market: MarketDataSource): StrategySource[] {
  return [arjumScreenerSource(market)];
}

/**
 * Every source's strategies and candidates in one envelope: as fresh as its stalest source,
 * as of its oldest data. A strategy id already taken by an earlier source is skipped and logged.
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
  for (const run of runs) {
    for (const strategy of run.strategies) {
      const taken = owner.get(strategy.id);
      if (taken) {
        logWarn("strategy_id_collision", { id: strategy.id, source: run.source.id, keptSource: taken });
        continue;
      }
      owner.set(strategy.id, run.source.id);
      strategies.push(strategy);
      candidates.push(...run.candidates.filter((candidate) => candidate.strategyId === strategy.id && candidate.source === run.source.id));
    }
  }

  const envelopes = runs.map((run) => run.context);
  return withFreshness(
    { contexts: envelopes.map((envelope) => envelope.data), strategies, candidates },
    {
      freshness: leastFresh(envelopes.map((envelope) => envelope.freshness)),
      asOf: envelopes.map((envelope) => envelope.asOf).filter((asOf): asOf is string => asOf !== null).sort()[0] ?? null,
      source: envelopes.map((envelope) => envelope.source).join("+"),
      period: envelopes.length === 1 ? envelopes[0].period : undefined,
    },
  );
}

export type { StrategySource } from "./source";
