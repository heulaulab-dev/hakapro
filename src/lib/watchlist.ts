"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { addWatchlistItem, listWatchlist, removeWatchlistItem } from "@/server/actions/watchlists";
export type { Watchlist, WatchlistItem } from "@/lib/user-data";

/** userId partitions the cache; the server derives ownership from the session. */
export function useWatchlist(userId: string | null) {
  return useQuery({ queryKey: queryKeys.watchlist(userId ?? "none"), queryFn: () => listWatchlist(), enabled: userId !== null });
}

export function useWatchlistMutations(userId: string | null, defaultName: string) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.watchlist(userId ?? "none") });
  const add = useMutation({ mutationFn: (symbol: string) => addWatchlistItem(symbol, defaultName), onSettled: invalidate });
  const remove = useMutation({ mutationFn: (itemId: string) => removeWatchlistItem(itemId), onSettled: invalidate });
  return { add, remove };
}
