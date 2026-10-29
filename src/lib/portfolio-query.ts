"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addPortfolioTransaction, listPortfolio, removePortfolioTransaction } from "@/server/actions/portfolios";
import { queryKeys } from "./query/keys";

export function usePortfolio(userId: string | null) { return useQuery({ queryKey: queryKeys.portfolio(userId ?? "anonymous"), queryFn: listPortfolio, enabled: userId !== null }); }
export function usePortfolioMutations(userId: string | null) {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.portfolio(userId ?? "anonymous") });
  return { add: useMutation({ mutationFn: addPortfolioTransaction, onSettled: invalidate }), remove: useMutation({ mutationFn: removePortfolioTransaction, onSettled: invalidate }) };
}
