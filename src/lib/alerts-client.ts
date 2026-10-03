"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import type { AlertMetric, AlertOperator } from "./alerts";

export type AlertRow = { id: string; symbol: string; metric: AlertMetric; operator: AlertOperator; threshold: number; enabled: boolean; last_triggered_at: string | null };
export type AlertEventRow = { id: string; observed_value: number; observed_as_of: string; triggered_at: string; alert: { symbol: string; metric: AlertMetric; operator: AlertOperator; threshold: number } | null };

const key = (userId: string) => ["user", "alerts", userId] as const;
const eventsKey = (userId: string) => ["user", "alert-events", userId] as const;

/** RLS (alerts_own, alert_events_own) scopes everything to the signed-in user. */
export function useAlerts(userId: string | null) {
  return useQuery({
    queryKey: key(userId ?? "none"), enabled: userId !== null,
    queryFn: async () => {
      const { data, error } = await createClient().from("alerts").select("id, symbol, metric, operator, threshold, enabled, last_triggered_at").order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({ ...row, threshold: Number(row.threshold) })) as AlertRow[];
    },
  });
}

export function useAlertEvents(userId: string | null) {
  return useQuery({
    queryKey: eventsKey(userId ?? "none"), enabled: userId !== null,
    queryFn: async () => {
      const { data, error } = await createClient().from("alert_events").select("id, observed_value, observed_as_of, triggered_at, alert:alerts(symbol, metric, operator, threshold)").order("triggered_at", { ascending: false }).limit(30);
      if (error) throw error;
      return (data ?? []) as unknown as AlertEventRow[];
    },
  });
}

export function useAlertMutations(userId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key(userId ?? "none") });
  const create = useMutation({
    mutationFn: async (alert: { symbol: string; metric: AlertMetric; operator: AlertOperator; threshold: number }) => {
      const { error } = await createClient().from("alerts").insert(alert);
      if (error) throw error;
    },
    onSettled: invalidate,
  });
  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await createClient().from("alerts").update({ enabled }).eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient().from("alerts").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });
  return { create, toggle, remove };
}
