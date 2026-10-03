"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { accumulationApi, financialsApi, marketApi, overviewApi, quotesApi, screenerApi, type ReportType, type ScreenCondition } from "./market";

export const useHistory = (symbol: string, query: { frame?: string; limit?: number } = {}) =>
  useQuery({ queryKey: queryKeys.history(symbol, query.frame, query.limit), queryFn: ({ signal }) => marketApi.history(symbol, query, signal) });
export const useBrokerSummary = (symbol: string) =>
  useQuery({ queryKey: queryKeys.brokerSummary(symbol), queryFn: ({ signal }) => marketApi.brokerSummary(symbol, signal) });
export const useStrategies = () => useQuery({ queryKey: queryKeys.strategies(), queryFn: ({ signal }) => marketApi.strategies(signal) });
export const useInsiders = (symbol: string) => useQuery({ queryKey: queryKeys.insiders(symbol), queryFn: ({ signal }) => marketApi.insiders(symbol, signal) });
export const useMarketCap = () => useQuery({ queryKey: queryKeys.marketCap(), queryFn: ({ signal }) => marketApi.marketCap(signal) });
export const useStockOverview = (symbol: string) => useQuery({ queryKey: queryKeys.stockOverview(symbol), queryFn: ({ signal }) => overviewApi.stock(symbol, signal) });
export const useMarketOverview = () => useQuery({ queryKey: queryKeys.marketOverview(), queryFn: ({ signal }) => overviewApi.market(signal) });
export const useNews = (perPage = 8) => useQuery({ queryKey: queryKeys.news(perPage), queryFn: ({ signal }) => overviewApi.news(signal, perPage) });
export const useAnnouncements = (keywords: string) => useQuery({ queryKey: queryKeys.announcements(keywords), queryFn: ({ signal }) => overviewApi.announcements(keywords, signal) });
/** Company name for a ticker from search results (exact symbol match only). */
export const useCompanyName = (symbol: string) =>
  useQuery({ queryKey: queryKeys.search(symbol), queryFn: ({ signal }) => marketApi.search(symbol, signal), select: (envelope) => envelope.data.find((row) => row.symbol === symbol.toUpperCase())?.companyName ?? null });
export const useQuotes = (symbols: string[]) =>
  useQuery({ queryKey: queryKeys.quotes(symbols), queryFn: ({ signal }) => quotesApi.get(symbols, signal), enabled: symbols.length > 0 });
export const useBrokerAccumulation = (symbol: string, query: { startDate?: string; top?: number }) =>
  useQuery({ queryKey: queryKeys.brokerAccumulation(symbol, query.startDate, query.top), queryFn: ({ signal }) => accumulationApi.get(symbol, query, signal) });
export const useFinancials = (symbol: string, reportType: ReportType, period: "quarterly" | "annual") =>
  useQuery({ queryKey: queryKeys.financials(symbol, reportType, period), queryFn: ({ signal }) => financialsApi.get(symbol, reportType, period, signal) });
export const useScreen = (conditions: ScreenCondition[], enabled: boolean) =>
  useQuery({ queryKey: queryKeys.screen(conditions), queryFn: ({ signal }) => screenerApi.run(conditions, signal), enabled });
