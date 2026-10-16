// `{data, meta}` envelope of the idx-bei contract (src/server/schemas/idx-bei.ts). Every response is validated
// with the shared schema before it leaves, so the app's IdxBeiSource can always parse it.
import type { z } from "zod";
import type { Freshness } from "@/lib/freshness";
import { idxBeiEnvelope } from "@/server/schemas/idx-bei";

export const ENGINE_SOURCE = "hakapro-engine";

export type EngineMeta = { source: string; fetchedAt: string; dataAsOf: string | null; freshness: Freshness };

export function unavailableMeta(now: Date): EngineMeta {
  return { source: ENGINE_SOURCE, fetchedAt: now.toISOString(), dataAsOf: null, freshness: "UNAVAILABLE" };
}

/** Intraday snapshots are DELAYED with their own timestamp, never LIVE (§8.3). */
export function intradayMeta(snapshotTs: Date | null, now: Date): EngineMeta {
  if (!snapshotTs) return unavailableMeta(now);
  return { source: ENGINE_SOURCE, fetchedAt: now.toISOString(), dataAsOf: snapshotTs.toISOString(), freshness: "DELAYED" };
}

/** Meta for stored data: its data date (or WIB timestamp for intraday) and the freshness derived from it. */
export function servedMeta(served: { dataAsOf: string | null; freshness: Freshness }, now: Date): EngineMeta {
  // LIVE is never served (§8.3): no source behind the engine is a realtime feed.
  const freshness = served.freshness === "LIVE" ? "DELAYED" : served.freshness;
  return { source: ENGINE_SOURCE, fetchedAt: now.toISOString(), dataAsOf: served.dataAsOf, freshness };
}

export function envelope<T extends z.ZodType>(schema: T, data: z.input<T>, meta: EngineMeta): z.infer<ReturnType<typeof idxBeiEnvelope<T>>> {
  return idxBeiEnvelope(schema).parse({ data, meta });
}
