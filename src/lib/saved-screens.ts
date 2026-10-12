"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { createSavedScreen, deleteSavedScreen, listSavedScreens, updateSavedScreen } from "@/server/actions/saved-screeners";
export type { SavedScreen } from "@/lib/user-data";

/** userId partitions the cache; every operation uses the authenticated session. */
export function useSavedScreens(userId: string | null, enabled = true) {
  return useQuery({ queryKey: queryKeys.savedScreens(userId ?? "none"), enabled: enabled && userId !== null, queryFn: () => listSavedScreens() });
}

export function useSavedScreenMutations(userId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.savedScreens(userId ?? "none") });
  const save = useMutation({ mutationFn: createSavedScreen, onSettled: invalidate });
  const update = useMutation({ mutationFn: updateSavedScreen, onSettled: invalidate });
  const remove = useMutation({ mutationFn: deleteSavedScreen, onSettled: invalidate });
  return { save, update, remove };
}
