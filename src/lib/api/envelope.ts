import { z } from "zod";
import { FRESHNESS_STATES, type WithFreshness } from "@/lib/freshness";

export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status: number) {
    super(code);
    this.name = "ApiError";
  }
}

export const envelopeSchema = <T extends z.ZodType>(data: T) =>
  z.object({
    data,
    freshness: z.enum(FRESHNESS_STATES),
    asOf: z.string().nullable(),
    period: z.string().optional(),
    source: z.string(),
  });

/** Fetches a BFF route and validates its freshness envelope; API errors surface as ApiError(code). */
export async function fetchEnvelope<T extends z.ZodType>(url: string, data: T, init?: RequestInit): Promise<WithFreshness<z.infer<T>>> {
  const response = await fetch(url, init);
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = body && typeof body === "object" && "error" in body && typeof body.error === "string" ? body.error : "REQUEST_FAILED";
    throw new ApiError(code, response.status);
  }
  const parsed = envelopeSchema(data).safeParse(body);
  if (!parsed.success) throw new ApiError("MALFORMED_RESPONSE", 502);
  return parsed.data as WithFreshness<z.infer<T>>;
}
