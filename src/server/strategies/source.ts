import type { WithFreshness } from "@/lib/freshness";
import type { ScreenerCandidate, ScreenerContext, ScreenerStrategy, StrategySourceId } from "@/lib/strategies/contract";

/**
 * One strategy engine as the BFF sees it. Implementations map their own output into the contract
 * (src/lib/strategies/contract.ts); nothing provider-specific leaves them. A source reads its run
 * once per instance, so list() plus candidates() for every strategy cost one upstream request.
 */
export interface StrategySource {
  readonly id: StrategySourceId;
  /** The run's context, in the run's freshness envelope (`source` = market lane, e.g. "fixture:arjum"). */
  context(signal?: AbortSignal): Promise<WithFreshness<ScreenerContext>>;
  list(signal?: AbortSignal): Promise<ScreenerStrategy[]>;
  /** Candidates of one strategy in the source's order; an unknown id has none. */
  candidates(strategyId: string, signal?: AbortSignal): Promise<ScreenerCandidate[]>;
}
