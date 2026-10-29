import { z } from "zod";
import { symbolSchema } from "./inputs";

export const intelligenceFreshnessSchema = z.enum(["LIVE", "DELAYED", "EOD", "HISTORICAL", "STALE", "UNAVAILABLE"]);
export const catalystEventSchema = z.object({
  kind: z.enum(["NEWS", "ACTION", "OWNERSHIP", "FUNDAMENTAL", "FLOW", "PROFILE"]),
  headline: z.string(), detail: z.string().nullable(), occurredAt: z.string(),
  source: z.string(), asOf: z.string().nullable(), freshness: intelligenceFreshnessSchema,
  confidence: z.enum(["high", "medium", "low"]),
});
export const catalystsSchema = z.object({ symbol: symbolSchema, events: z.array(catalystEventSchema), available: z.boolean() });
export const breadthRegimeSchema = z.enum(["RISK_ON", "RISK_OFF", "MIXED", "UNAVAILABLE"]);
export const breadthSchema = z.object({
  snapshotDate: z.string().nullable(), source: z.string(), freshness: intelligenceFreshnessSchema,
  advancers: z.number().int().nonnegative(), decliners: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(),
  participation: z.number().min(0).max(1).nullable(), regime: breadthRegimeSchema,
  sectors: z.array(z.object({ sector: z.string(), changePercent: z.number().nullable(), advancers: z.number().int().nonnegative(), decliners: z.number().int().nonnegative() })),
});
export const breadthHistoryWindowSchema = z.enum(["1M", "3M", "6M", "1Y"]);
export const breadthHistorySchema = z.object({
  window: breadthHistoryWindowSchema,
  snapshotDate: z.string().nullable(), source: z.string(), freshness: intelligenceFreshnessSchema,
  series: z.array(z.object({
    date: z.string(), advancers: z.number().int().nonnegative(), decliners: z.number().int().nonnegative(), unchanged: z.number().int().nonnegative(),
    comparable: z.number().int().nonnegative(), observed: z.number().int().nonnegative(), coverage: z.number().min(0).max(1).nullable(),
    netAdvanceRate: z.number().min(-1).max(1).nullable(), cumulativePressure: z.number().nullable(),
    aboveSma20Pct: z.number().min(0).max(1).nullable(), aboveSma20Eligible: z.number().int().nonnegative(),
    advancingValueIdr: z.number().nonnegative(), decliningValueIdr: z.number().nonnegative(), valueObserved: z.number().int().nonnegative(),
    valueCoverage: z.number().min(0).max(1).nullable(), advancingValueShare: z.number().min(0).max(1).nullable(),
  })),
});
export type BreadthHistory = z.infer<typeof breadthHistorySchema>;
export const ownershipNetworkSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), label: z.string(), kind: z.enum(["issuer", "holder"]) })),
  edges: z.array(z.object({ from: z.string(), to: z.string(), percent: z.string().nullable(), shares: z.string().nullable(), month: z.string(), sourceReference: z.string(), confidence: z.literal("exact") })),
  ambiguous: z.number().int().nonnegative(),
});
