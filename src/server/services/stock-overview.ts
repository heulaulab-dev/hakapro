import "server-only";
import { withFreshness, type FreshnessMeta, type WithFreshness } from "@/lib/freshness";
import { MarketDataError } from "@/server/market/errors";
import type { MarketDataSource } from "@/server/market/source";
import { summarizeBrokers, summarizeFinancials, summarizeForeignFlow, summarizeInsiders, summarizePrice, type FinancialFacts, type FlowFacts, type OwnershipFacts, type PriceFacts } from "./stock-summary";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";

export type Section<T> = ({ status: "ok"; data: T } & FreshnessMeta) | { status: "error"; error: string };

export type StockOverview = {
  symbol: string;
  price: Section<PriceFacts>;
  foreignFlow: Section<NonNullable<FlowFacts["foreign"]>>;
  brokers: Section<NonNullable<FlowFacts["brokers"]>>;
  ownership: Section<OwnershipFacts>;
  financials: Section<FinancialFacts>;
};

async function section<E, T>(load: () => Promise<WithFreshness<E>>, derive: (data: E) => T | null): Promise<Section<T>> {
  try {
    const envelope = await load();
    const data = derive(envelope.data);
    if (data === null) return { status: "error", error: "EMPTY" };
    return { status: "ok", data, freshness: envelope.freshness, asOf: envelope.asOf, period: envelope.period, source: envelope.source };
  } catch (error) {
    // Auth/config errors must not be masked as a partial page; let the route answer them.
    if (error instanceof MarketDataError && (error.code === "NOT_CONFIGURED" || error.code === "PROVIDER_UNAUTHORIZED")) throw error;
    return { status: "error", error: error instanceof MarketDataError ? error.code : "INTERNAL_ERROR" };
  }
}

/**
 * Aggregates the per-dataset summaries for the Stock Overview. Each section carries its own
 * freshness and fails independently; the envelope's freshness is the headline (price) section's.
 */
export async function getStockOverview(source: MarketDataSource, symbol: string, signal?: AbortSignal): Promise<WithFreshness<StockOverview>> {
  const history = source.history(symbol, { frame: "daily", limit: 250 }, signal);
  const [price, foreignFlow, brokers, ownership, financials] = await Promise.all([
    section(() => history, (data) => summarizePrice(data)),
    section(() => history, (data) => summarizeForeignFlow(data)),
    section(() => source.brokerSummary(symbol, {}, signal), (data) => summarizeBrokers(data)),
    section(() => source.insiders(symbol, { limit: ARJUM_LIMITS.insiders }, signal), (data) => summarizeInsiders(data)),
    section(() => source.financialStatements(symbol, { reportType: "INCOME_STATEMENT", period: "quarterly", limit: 12 }, signal), (data) => summarizeFinancials(data)),
  ]);
  const overview: StockOverview = { symbol, price, foreignFlow, brokers, ownership, financials };
  if (price.status === "ok") return withFreshness(overview, { freshness: price.freshness, asOf: price.asOf, source: price.source ?? source.id });
  return withFreshness(overview, { freshness: "UNAVAILABLE", asOf: null, source: source.id });
}
