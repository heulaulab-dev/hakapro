"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { screenConditionSchema, type ScreenCondition } from "@/lib/api/market";
import { queryKeys } from "@/lib/query/keys";
import { createClient } from "@/lib/supabase/client";

export type SavedScreen = { id: string; name: string; conditions: ScreenCondition[] };

/** Rows are user data (RLS: saved_screeners_own); conditions are re-validated before use. */
const conditionsSchema = z.array(screenConditionSchema).max(20);

export function useSavedScreens(userId: string | null) {
  return useQuery({
    queryKey: queryKeys.savedScreens(userId ?? "none"),
    enabled: userId !== null,
    queryFn: async (): Promise<SavedScreen[]> => {
      const { data, error } = await createClient().from("saved_screeners").select("id, name, conditions").order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).flatMap((row) => {
        const parsed = conditionsSchema.safeParse(row.conditions);
        return parsed.success ? [{ id: row.id, name: row.name, conditions: parsed.data }] : [];
      });
    },
  });
}

export function useSavedScreenMutations(userId: string | null) {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.savedScreens(userId ?? "none") });
  const save = useMutation({
    mutationFn: async ({ name, conditions }: { name: string; conditions: ScreenCondition[] }) => {
      const { data, error } = await createClient().from("saved_screeners").insert({ name, conditions, sort_config: {} }).select("id").single();
      if (error) throw error;
      return data.id;
    },
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await createClient().from("saved_screeners").delete().eq("id", id);
      if (error) throw error;
    },
    onSettled: invalidate,
  });
  return { save, remove };
}
