import "server-only";
import type { WithFreshness } from "@/lib/freshness";
import type { Reason, ScreenerCandidate, ScreenerContext, ScreenerStrategy } from "@/lib/strategies/contract";
import type { MarketDataSource } from "@/server/market";
import type { StrategyScreen } from "@/server/market/types";
import type { StrategySource } from "./source";

const SOURCE = "ARJUM_SCREENER";

type StrategyMatch = StrategyScreen["strategies"][number]["matches"][number];

/**
 * arjum strategy screener (parsed by services/why-matched.ts) → Strategy Engine contract.
 * The parser has already dropped the direction arrow, win rate, "potensi" and drawdown (§9.5);
 * the row's wr_event/potential/drawdown are never mapped, so arjum candidates carry no metrics
 * and no score.
 */
export function fromArjumScreen({ data: screen, freshness, asOf }: WithFreshness<StrategyScreen>): {
  context: ScreenerContext; strategies: ScreenerStrategy[]; candidates: ScreenerCandidate[];
} {
  return {
    context: { source: SOURCE, version: screen.screenerVersion, marketCondition: screen.marketCondition, universe: screen.universe },
    strategies: screen.strategies.map((strategy) => ({
      id: strategy.id, label: strategy.name, description: strategy.description, source: SOURCE, kind: "EOD", dataAsOf: asOf, freshness,
    })),
    candidates: screen.strategies.flatMap((strategy) => strategy.matches.map((match) => ({
      symbol: match.symbol,
      name: match.name,
      strategyId: strategy.id,
      // The screener doesn't timestamp rows: a stock was detected in the run of the screen date.
      detectedAt: screen.date,
      dataAsOf: asOf,
      freshness,
      score: null,
      reasons: reasons(match),
      metrics: [],
      source: SOURCE,
    }))),
  };
}

function reasons(match: StrategyMatch): Reason[] {
  return [
    ...match.criteria.map((criterion): Reason => criterion.kind === "recognized"
      ? { kind: "criterion", key: criterion.key }
      : { kind: "unrecognized", code: criterion.flag, label: criterion.providerLabel }),
    ...(match.pattern ? [{ kind: "pattern", text: match.pattern } as const] : []),
    ...match.notes.map((text) => ({ kind: "note", text }) as const),
  ];
}

/** The arjum screener as a strategy source. One instance reads `/api/screener/latest` at most once. */
export function arjumScreenerSource(market: MarketDataSource): StrategySource {
  let run: Promise<{ envelope: WithFreshness<StrategyScreen> } & ReturnType<typeof fromArjumScreen>> | null = null;
  const load = (signal?: AbortSignal) => (run ??= market.strategies(signal).then((envelope) => ({ envelope, ...fromArjumScreen(envelope) })));
  return {
    id: SOURCE,
    async context(signal) {
      const { envelope, context } = await load(signal);
      return { ...envelope, data: context };
    },
    async list(signal) {
      return (await load(signal)).strategies;
    },
    async candidates(strategyId, signal) {
      return (await load(signal)).candidates.filter((candidate) => candidate.strategyId === strategyId);
    },
  };
}
