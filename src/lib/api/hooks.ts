"use client";

import { useInfiniteQuery, useQueries, useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import {
  accumulationApi, analysisApi, engineApi, financialsApi, marketApi, overviewApi, priceApi, quotesApi, screenerApi, stockApi,
  type BrokerSummaryQuery, type FinancialsQuery, type HistoryQuery, type MarketBrokerSummaryQuery, type MarketCapQuery, type RecentInsidersQuery, type ScreenCondition,
  type GroupWindow,
  type BreadthWindow,
} from "./market";
import { shouldRetry } from "@/lib/query/client";
import { fetchResearchBrief, ResearchUnavailableError } from "./research";

/** Keeps the previous result on screen while a filter changes, but never across symbols. */
function keepSameSymbol<E extends { data: { symbol: string } }>(previous: E | undefined, symbol: string): E | undefined {
  return previous?.data.symbol === symbol.toUpperCase() ? previous : undefined;
}

export const useHistory = (symbol: string, query: HistoryQuery = {}, options: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: queryKeys.history(symbol, query.frame, query.limit, query.startDate, query.endDate), queryFn: ({ signal }) => marketApi.history(symbol, query, signal), enabled: options.enabled ?? true, placeholderData: (previous) => keepSameSymbol(previous, symbol) });
export const useMarketBrokerSummary = (query: MarketBrokerSummaryQuery) =>
  useQuery({ queryKey: queryKeys.marketBrokerSummary(query.from, query.to, query.limit), queryFn: ({ signal }) => marketApi.marketBrokerSummary(query, signal), staleTime: 300_000 });
export const useComparisonHistory = (symbol: string, query: HistoryQuery = {}, options: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: queryKeys.comparisonHistory(symbol, query.startDate ?? query.endDate ?? "all"), queryFn: ({ signal }) => marketApi.history(symbol, { ...query, frame: "daily" }, signal), enabled: options.enabled ?? true, placeholderData: (previous) => keepSameSymbol(previous, symbol) });
export const useComparisonHistories = (symbols: string[], query: HistoryQuery = {}) => useQueries({
  queries: symbols.map((symbol) => ({
    queryKey: queryKeys.comparisonHistory(symbol, `${query.startDate ?? ""}:${query.endDate ?? ""}`),
    queryFn: ({ signal }: { signal: AbortSignal }) => marketApi.history(symbol, { ...query, frame: "daily" }, signal),
    placeholderData: (previous: Awaited<ReturnType<typeof marketApi.history>> | undefined) => keepSameSymbol(previous, symbol),
  })),
});
export const useBrokerSummary = (symbol: string, query: BrokerSummaryQuery = {}, options: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: queryKeys.brokerSummary(symbol, query), queryFn: ({ signal }) => marketApi.brokerSummary(symbol, query, signal), enabled: options.enabled ?? true, placeholderData: (previous) => keepSameSymbol(previous, symbol) });
export const useStrategies = () => useQuery({ queryKey: queryKeys.strategies(), queryFn: ({ signal }) => marketApi.strategies(signal) });
export const useInsiders = (symbol: string) => useQuery({ queryKey: queryKeys.insiders(symbol), queryFn: ({ signal }) => marketApi.insiders(symbol, signal) });
export const useMarketCap = (query: MarketCapQuery = {}, options: { enabled?: boolean } = {}) =>
  useQuery({ queryKey: queryKeys.marketCap(query), queryFn: ({ signal }) => marketApi.marketCap(query, signal), enabled: options.enabled ?? true, placeholderData: (previous) => previous });
export const useStockOverview = (symbol: string) => useQuery({ queryKey: queryKeys.stockOverview(symbol), queryFn: ({ signal }) => overviewApi.stock(symbol, signal) });
export const useMarketOverview = () => useQuery({ queryKey: queryKeys.marketOverview(), queryFn: ({ signal }) => overviewApi.market(signal) });
export const useNews = (perPage = 8) => useQuery({ queryKey: queryKeys.news(perPage), queryFn: ({ signal }) => overviewApi.news(signal, perPage) });
export const useAnnouncements = (keywords: string) => useQuery({ queryKey: queryKeys.announcements(keywords), queryFn: ({ signal }) => overviewApi.announcements(keywords, signal) });
/** Company name for a ticker from search results (exact symbol match only). */
export const useCompanyName = (symbol: string) =>
  useQuery({ queryKey: queryKeys.search(symbol), queryFn: ({ signal }) => marketApi.search(symbol, signal), select: (envelope) => envelope.data.find((row) => row.symbol === symbol.toUpperCase())?.companyName ?? null });
export const useQuotes = (symbols: string[]) =>
  useQuery({ queryKey: queryKeys.quotes(symbols), queryFn: ({ signal }) => quotesApi.get(symbols, signal), enabled: symbols.length > 0 });
export const useBrokerAccumulation = (symbol: string, query: { startDate?: string; top?: number; brokers?: string[] }) =>
  useQuery({ queryKey: queryKeys.brokerAccumulation(symbol, query.startDate, query.top, query.brokers?.join(",")), queryFn: ({ signal }) => accumulationApi.get(symbol, query, signal) });
export const useFinancials = (symbol: string, query: FinancialsQuery) =>
  useQuery({ queryKey: queryKeys.financials(symbol, query.reportType, query.period, query.limit, query.year ?? null), queryFn: ({ signal }) => financialsApi.get(symbol, query, signal), placeholderData: (previous) => keepSameSymbol(previous, symbol) });
export const useScreen = (conditions: ScreenCondition[], enabled: boolean) =>
  useQuery({ queryKey: queryKeys.screen(conditions), queryFn: ({ signal }) => screenerApi.run(conditions, signal), enabled });
export const useDoneDetails = (symbol: string, date: string | null = null, page = 1) =>
  useQuery({ queryKey: queryKeys.doneDetails(symbol, date, page), queryFn: ({ signal }) => stockApi.doneDetails(symbol, { date, page }, signal), placeholderData: (previous) => keepSameSymbol(previous, symbol) });
export const usePrice = (symbol: string) => useQuery({ queryKey: queryKeys.price(symbol), queryFn: ({ signal }) => priceApi.get(symbol, signal) });
export const useAnalysis = (symbol: string) => useQuery({ queryKey: queryKeys.analysis(symbol), queryFn: ({ signal }) => analysisApi.get(symbol, signal) });
/** One provider request per symbol; only runs when asked (a user action), never in the background. */
export const useAnalysisCompare = (symbols: string[]) =>
  useQuery({ queryKey: queryKeys.analysisCompare(symbols), queryFn: ({ signal }) => analysisApi.compare(symbols, signal), enabled: symbols.length > 0 });
export const useSeasonality = (symbol: string) => useQuery({ queryKey: queryKeys.seasonality(symbol), queryFn: ({ signal }) => stockApi.seasonality(symbol, signal) });
export const useProfile = (symbol: string) => useQuery({ queryKey: queryKeys.profile(symbol), queryFn: ({ signal }) => stockApi.profile(symbol, signal) });
export const useSectors = () => useQuery({ queryKey: queryKeys.sectors(), queryFn: ({ signal }) => engineApi.sectors(signal) });
export const useMacro = () => useQuery({ queryKey: queryKeys.macro(), queryFn: ({ signal }) => engineApi.macro(signal) });
/** IHSG + IDX-IC sector-index daily closes for the sector-rotation RRG. */
export const useIndicesHistory = (query: { codes?: string[]; from?: string; to?: string } = {}) =>
  useQuery({ queryKey: queryKeys.indicesHistory(query.codes, query.from, query.to), queryFn: ({ signal }) => engineApi.indicesHistory(query, signal), enabled: Boolean(query.from && query.to) });
export const useIssuerRace = (window: "1M" | "3M" | "6M" | "1Y", sector: string) =>
  useQuery({ queryKey: queryKeys.issuerRace(window, sector), queryFn: ({ signal }) => engineApi.issuerRace({ window, sector }, signal), staleTime: 300_000 });
export const useStockSectorRotation = (sector: string, interval: "daily" | "weekly") =>
  useQuery({ queryKey: queryKeys.stockSectorRotation(sector, interval), queryFn: ({ signal }) => engineApi.stockSectorRotation({ sector, interval }, signal), staleTime: 300_000, enabled: Boolean(sector) });
/** The most-traded `limit` stocks with sector totals; the previous limit's map stays on screen while the next loads. */
export const useHeatmap = (limit: number) =>
  useQuery({ queryKey: queryKeys.heatmap(limit), queryFn: ({ signal }) => engineApi.heatmap(limit, signal), placeholderData: (previous) => previous });
export const useGroups = (window: GroupWindow = "1D") => useQuery({ queryKey: queryKeys.groups(window), queryFn: ({ signal }) => engineApi.groups(window, signal) });
export const useRadar = () => useQuery({ queryKey: queryKeys.radar(), queryFn: ({ signal }) => engineApi.radar(signal) });
export const useStealthOwnership = () => useQuery({ queryKey: queryKeys.stealthOwnership(), queryFn: ({ signal }) => engineApi.stealthOwnership(signal) });
export const useActionsCalendar = (range: { from?: string; to?: string } = {}) =>
  useQuery({ queryKey: queryKeys.actionsCalendar(range.from, range.to), queryFn: ({ signal }) => engineApi.actionsCalendar(range, signal) });
export const useOwnership = (symbol: string) => useQuery({ queryKey: queryKeys.ownership(symbol), queryFn: ({ signal }) => engineApi.ownership(symbol, signal) });
export const useOwnershipChanges = (query: { month?: string; symbol?: string } = {}) =>
  useQuery({ queryKey: queryKeys.ownershipChanges(query.month, query.symbol), queryFn: ({ signal }) => engineApi.ownershipChanges(query, signal) });
export const useOwnershipScreener = () => useQuery({ queryKey: queryKeys.ownershipScreener(), queryFn: ({ signal }) => engineApi.ownershipScreener(signal) });
export const useOwnershipNetwork = (month?: string) => useQuery({ queryKey: queryKeys.ownershipNetwork(month), queryFn: ({ signal }) => engineApi.ownershipNetwork({ month }, signal) });
/** Market-wide insider feed; keeps the previous list on screen while the action filter changes. */
export const useRecentInsiders = (query: RecentInsidersQuery = {}) =>
  useQuery({ queryKey: queryKeys.recentInsiders(query.days, query.action ?? null, query.limit), queryFn: ({ signal }) => engineApi.recentInsiders(query, signal), placeholderData: (previous) => previous });
export const useCatalysts = (symbol: string) => useQuery({ queryKey: queryKeys.catalysts(symbol), queryFn: ({ signal }) => engineApi.catalysts(symbol, signal) });
export const useDividendPatterns = (symbol: string) => useQuery({ queryKey: queryKeys.dividendPatterns(symbol), queryFn: ({ signal }) => engineApi.dividendPatterns(symbol, signal) });
export const useBreadth = () => useQuery({ queryKey: queryKeys.breadth(), queryFn: ({ signal }) => engineApi.breadth(signal) });
export const useBreadthHistory = (window: BreadthWindow) => useQuery({ queryKey: queryKeys.breadthHistory(window), queryFn: ({ signal }) => engineApi.breadthHistory(window, signal), staleTime: 300_000, placeholderData: (previous) => previous });
export const useForeignFlowPulse = () => useQuery({ queryKey: queryKeys.foreignFlowPulse(), queryFn: ({ signal }) => engineApi.foreignFlowPulse(signal), staleTime: 300_000 });
export const useCorporateActions =(symbol: string) => useQuery({ queryKey: queryKeys.actions(symbol), queryFn: ({ signal }) => stockApi.actions(symbol, signal) });
/**
 * Newest-first insider disclosures, one provider page per user "load older" action (no background crawling).
 * Stops when the provider answers with a different page than requested (e.g. a recording that ignores `page`).
 */
export const useInsiderDisclosures = (symbol: string, limit: number) =>
  useInfiniteQuery({
    queryKey: queryKeys.insiderDisclosures(symbol, limit),
    queryFn: ({ pageParam, signal }) => stockApi.insiders(symbol, { page: pageParam, limit }, signal),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (last.data.page === all.length && last.data.page < last.data.totalPages ? last.data.page + 1 : undefined),
  });
export const useInsidersPage = (symbol: string, page: number, limit: number, action: string | null) =>
  useQuery({ queryKey: queryKeys.insidersPage(symbol, page, limit, action), queryFn: ({ signal }) => stockApi.insiders(symbol, { page, limit, action }, signal), placeholderData: (previous) => keepSameSymbol(previous, symbol) });
/** Research Brief: computed server-side once per ticker per trading day. */
export const useResearchBrief = (code: string) =>
  useQuery({
    queryKey: queryKeys.research(code),
    queryFn: ({ signal }) => fetchResearchBrief(code, signal),
    // A missing price won't appear on an immediate retry; the page explains what is missing instead.
    retry: (failureCount, error) => !(error instanceof ResearchUnavailableError) && shouldRetry(failureCount, error),
  });
