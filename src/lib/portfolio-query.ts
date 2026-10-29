"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addPortfolioTransaction, listPortfolio, removePortfolioTransaction } from "@/server/actions/portfolios";
import { queryKeys } from "./query/keys";

export function usePortfolio(enabled: boolean) { return useQuery({ queryKey: queryKeys.portfolio(), queryFn: listPortfolio, enabled }); }
export function usePortfolioMutations() {
  const client = useQueryClient();
  const invalidate = () => client.invalidateQueries({ queryKey: queryKeys.portfolio() });
  return { add: useMutation({ mutationFn: addPortfolioTransaction, onSettled: invalidate }), remove: useMutation({ mutationFn: removePortfolioTransaction, onSettled: invalidate }) };
}
