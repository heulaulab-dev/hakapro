"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createAlert, deleteAlert, listAlertEvents, listAlerts, updateAlert } from "@/server/actions/alerts";
export type { AlertRow, AlertEventRow } from "@/lib/user-data";

const key = (userId: string) => ["user", "alerts", userId] as const;
const eventsKey = (userId: string) => ["user", "alert-events", userId] as const;

/** IDs partition caches; the session determines ownership on the server. */
export function useAlerts(userId: string | null) {
  return useQuery({ queryKey: key(userId ?? "none"), enabled: userId !== null, queryFn: () => listAlerts() });
}

export function useAlertEvents(userId: string | null) {
  return useQuery({ queryKey: eventsKey(userId ?? "none"), enabled: userId !== null, queryFn: () => listAlertEvents() });
}

export function useAlertMutations(userId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key(userId ?? "none") }),
      queryClient.invalidateQueries({ queryKey: eventsKey(userId ?? "none") }),
    ]);
  };
  const create = useMutation({ mutationFn: createAlert, onSettled: invalidate });
  const update = useMutation({ mutationFn: updateAlert, onSettled: invalidate });
  const toggle = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateAlert({ id, enabled }), onSettled: invalidate });
  const remove = useMutation({ mutationFn: deleteAlert, onSettled: invalidate });
  return { create, update, toggle, remove };
}
