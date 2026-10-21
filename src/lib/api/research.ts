/**
 * Client contract for GET /api/research/[code] (mirrors src/server/services/research-brief.ts).
 * The body is the Research Brief itself, not a freshness envelope; it is validated again here.
 */
import { z } from "zod";
import { FRESHNESS_STATES } from "@/lib/freshness";
import { ApiError } from "./envelope";

export const COMPONENT_KEYS = ["momentum", "foreign", "broker", "ksei", "insider", "volume"] as const;
export type ComponentKey = (typeof COMPONENT_KEYS)[number];
export const RESEARCH_WINDOWS = ["1D", "5D", "7D", "14D", "30D"] as const;
export type ResearchWindow = (typeof RESEARCH_WINDOWS)[number];

const sourceRef = z.object({ table: z.string(), asOf: z.string().nullable() });
const bilingual = z.object({ id: z.string(), en: z.string() });

export const researchBriefSchema = z.object({
  code: z.string(),
  name: z.string().nullable(),
  sector: z.string().nullable(),
  asOf: z.string(),
  freshness: z.enum(["fresh", "stale", "missing"]),
  price: z.object({ last: z.number(), change: z.number().nullable(), changePct: z.number().nullable(), window: z.literal("1D"), session: z.string(), source: sourceRef,
    meta: z.object({ freshness: z.enum(FRESHNESS_STATES), asOf: z.string().nullable(), source: z.string() }),
  }),
  score: z.object({ value: z.null(), confidence: z.number(), version: z.string() }),
  windows: z.array(z.enum(RESEARCH_WINDOWS)),
  components: z.array(z.object({
    key: z.enum(COMPONENT_KEYS),
    weight: z.number(),
    raw: z.record(z.string(), z.union([z.number(), z.string(), z.null()])),
    points: z.number().nullable(),
    status: z.enum(["ok", "stale", "missing"]),
    reason: z.string().nullable(),
    source: sourceRef,
  })),
  insiderTransactions: z.array(z.object({
    date: z.string(), person: z.string(), action: z.enum(["BUY", "SELL", "CROSS", "OTHER"]), roles: z.array(z.string()), changeShares: z.number().nullable(), priceIdr: z.number().nullable(),
  })),
  counterEvidence: z.array(z.object({ key: z.string(), component: z.enum(["foreign", "broker", "insider"]), window: z.string().nullable(), text: bilingual })),
  checks: z.array(z.object({ key: z.enum(["price_history", "foreign_sources", "broker_windows"]), result: z.enum(["match", "mismatch", "not_applicable"]) })),
  sources: z.array(z.object({ table: z.string(), asOf: z.string().nullable(), rows: z.number(), range: z.string().nullable() })),
  quota: z.object({ used: z.number(), limit: z.number().nullable(), charged: z.boolean() }),
  generatedAt: z.string(),
});
export type ResearchBrief = z.infer<typeof researchBriefSchema>;
export type BriefComponent = ResearchBrief["components"][number];

/** 503 `data_unavailable` carries the names of the missing components. */
export class ResearchUnavailableError extends ApiError {
  constructor(public readonly missing: string[]) {
    super("data_unavailable", 503);
    this.name = "ResearchUnavailableError";
  }
}

export async function fetchResearchBrief(code: string, signal?: AbortSignal): Promise<ResearchBrief> {
  const response = await fetch(`/api/research/${encodeURIComponent(code.toUpperCase())}`, { signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const errorCode = typeof record.error === "string" ? record.error : "REQUEST_FAILED";
    if (errorCode === "data_unavailable") throw new ResearchUnavailableError(Array.isArray(record.missing) ? record.missing.filter((item): item is string => typeof item === "string") : []);
    throw new ApiError(errorCode, response.status);
  }
  const parsed = researchBriefSchema.safeParse(body);
  if (!parsed.success) throw new ApiError("MALFORMED_RESPONSE", 502);
  return parsed.data;
}
