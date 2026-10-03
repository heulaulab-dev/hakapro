"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/keys";
import { createClient } from "@/lib/supabase/client";

/** Row-level security (watchlists_own / watchlist_items_own) scopes every query to the signed-in user. */
export type WatchlistItem = { id: string; symbol: string; position: number };
export type Watchlist = { id: string | null; items: WatchlistItem[] };

async function loadDefault(): Promise<Watchlist> {
  const supabase = createClient();
  const { data: list, error } = await supabase.from("watchlists").select("id").eq("is_default", true).maybeSingle();
  if (error) throw error;
  if (!list) return { id: null, items: [] };
  const { data: items, error: itemsError } = await supabase.from("watchlist_items").select("id, symbol, position").eq("watchlist_id", list.id).order("position");
  if (itemsError) throw itemsError;
  return { id: list.id, items: items ?? [] };
}

async function ensureDefault(name: string): Promise<string> {
  const supabase = createClient();
  const { data: existing, error } = await supabase.from("watchlists").select("id").eq("is_default", true).maybeSingle();
  if (error) throw error;
  if (existing) return existing.id;
  const { data, error: insertError } = await supabase.from("watchlists").insert({ name, is_default: true }).select("id").single();
  if (insertError) throw insertError;
  return data.id;
}

export function useWatchlist(userId: string | null) {
  return useQuery({ queryKey: queryKeys.watchlist(userId ?? "none"), queryFn: loadDefault, enabled: userId !== null });
}

export function useWatchlistMutations(userId: string | null, defaultName: string) {
  const queryClient = useQueryClient();
  const key = queryKeys.watchlist(userId ?? "none");
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });
  const add = useMutation({
    mutationFn: async (symbol: string) => {
      const listId = await ensureDefault(defaultName);
      const current = queryClient.getQueryData<Watchlist>(key)?.items ?? [];
      const { error } = await createClient().from("watchlist_items").insert({ watchlist_id: listId, symbol, position: current.length });
      if (error) throw error;
    },
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await createClient().from("watchlist_items").delete().eq("id", itemId);
      if (error) throw error;
    },
    onSettled: invalidate,
  });
  return { add, remove };
}
