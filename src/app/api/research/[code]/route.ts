import { NextResponse } from "next/server";
import { z } from "zod";
import { failure, guardRequest } from "@/server/http";
import { logError } from "@/server/log";
import { getMarketDataSource } from "@/server/market";
import { MarketDataError } from "@/server/market/errors";
import { symbolSchema } from "@/server/schemas/inputs";
import { BriefUnavailableError, getResearchBrief, UnknownTickerError } from "@/server/services/research-brief";

const querySchema = z.object({
  // Both languages are always in the body (counter-evidence carries id and en); `lang` is accepted for the contract.
  lang: z.enum(["id", "en"]).optional(),
  days: z.coerce.number().int().min(1).max(90).optional(),
});

/**
 * GET /api/research/[code]?lang=id|en&days=30 — the Research Brief (spec §3.7) without a score.
 * 401 not signed in, 404 unknown ticker, 503 `data_unavailable` (with `missing`) only when the price
 * itself is unavailable. Any other failing source marks its component missing; the brief still renders.
 */
export async function GET(request: Request, context: RouteContext<"/api/research/[code]">) {
  const requestId = crypto.randomUUID();
  const denied = await guardRequest(request, { endpoint: "research", limit: 30 }, requestId);
  if (denied) return denied;
  const code = symbolSchema.safeParse((await context.params).code);
  if (!code.success) return failure("NOT_FOUND", 404, requestId);
  const params = new URL(request.url).searchParams;
  const query = querySchema.safeParse({ lang: params.get("lang") || undefined, days: params.get("days") || undefined });
  if (!query.success) return failure("INVALID_REQUEST", 400, requestId);
  try {
    const brief = await getResearchBrief(getMarketDataSource(), code.data, { days: query.data.days });
    return NextResponse.json(brief, { headers: { "cache-control": "private, no-store", "x-request-id": requestId } });
  } catch (error) {
    if (error instanceof UnknownTickerError) return failure("NOT_FOUND", 404, requestId);
    if (error instanceof BriefUnavailableError) return failure("data_unavailable", 503, requestId, undefined, { missing: error.missing });
    if (error instanceof MarketDataError) return failure(error.code, error.status, requestId);
    logError("research_route_internal_error", { requestId });
    return failure("INTERNAL_ERROR", 500, requestId);
  }
}
