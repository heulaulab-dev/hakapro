"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { marketApi } from "./market";

export const useHistory = (symbol: string, query: { frame?: string; limit?: number } = {}) =>
  useQuery({ queryKey: queryKeys.history(symbol, query.frame, query.limit), queryFn: ({ signal }) => marketApi.history(symbol, query, signal) });
export const useBrokerSummary = (symbol: string) =>
  useQuery({ queryKey: queryKeys.brokerSummary(symbol), queryFn: ({ signal }) => marketApi.brokerSummary(symbol, signal) });
export const useStrategies = () => useQuery({ queryKey: queryKeys.strategies(), queryFn: ({ signal }) => marketApi.strategies(signal) });
export const useInsiders = (symbol: string) => useQuery({ queryKey: queryKeys.insiders(symbol), queryFn: ({ signal }) => marketApi.insiders(symbol, signal) });
export const useMarketCap = () => useQuery({ queryKey: queryKeys.marketCap(), queryFn: ({ signal }) => marketApi.marketCap(signal) });
