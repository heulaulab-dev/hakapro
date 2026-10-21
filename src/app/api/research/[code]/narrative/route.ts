import { NextResponse } from "next/server";
import { z } from "zod";
import { failure } from "@/server/http";
import { logError } from "@/server/log";
import { getMarketDataSource } from "@/server/market";
import { MarketDataError } from "@/server/market/errors";
import { symbolSchema } from "@/server/schemas/inputs";
import { getBriefNarrative } from "@/server/ai/narrative";
import { aiFailure, guardAiRequest } from "@/server/ai/route-helpers";
import { BriefUnavailableError, getResearchBrief, UnknownTickerError } from "@/server/services/research-brief";

export const runtime = "nodejs";

const querySchema = z.object({ lang: z.enum(["id", "en"]).default("id") });

/**
 * GET /api/research/[code]/narrative?lang=id|en — 3–5 neutral sentences phrasing the Research Brief (spec §3.8).
 * 200 `{ status: "ok", sentences }` or `{ status: "rejected", reason, sentences: null }` (the page then shows the
 * brief without text). 503 AI_NOT_CONFIGURED when AI is off, 429 AI_QUOTA_EXCEEDED, 502/503 AI_* on API errors.
 * Cached per ticker, trading session and language; the user is charged only for a narrative that passed validation.
 */
export async function GET(request: Request, context: RouteContext<"/api/research/[code]/narrative">) {
  const requestId = crypto.randomUUID();
  const gate = await guardAiRequest(request, { endpoint: "research-narrative", limit: 10 }, requestId);
  if (gate.response) return gate.response;
  const code = symbolSchema.safeParse((await context.params).code);
  if (!code.success) return failure("NOT_FOUND", 404, requestId);
  const query = querySchema.safeParse({ lang: new URL(request.url).searchParams.get("lang") || undefined });
  if (!query.success) return failure("INVALID_REQUEST", 400, requestId);
  const headers = { "cache-control": "private, no-store", "x-request-id": requestId };
  try {
    const brief = await getResearchBrief(getMarketDataSource(), code.data);
    const { outcome, cached, charged, quota } = await getBriefNarrative(brief, query.data.lang, { config: gate.config, userKey: gate.userKey });
    const body = outcome.status === "ok"
      ? { status: "ok", reason: null, ...outcome.narrative }
      : { status: "rejected", reason: outcome.reason, code: brief.code, lang: query.data.lang, session: brief.price.session, asOf: brief.asOf, sentences: null, model: null, generatedAt: null };
    return NextResponse.json({ ...body, cached, quota: { ...quota, charged } }, { headers });
  } catch (error) {
    const ai = aiFailure(error, requestId);
    if (ai) return ai;
    if (error instanceof UnknownTickerError) return failure("NOT_FOUND", 404, requestId);
    if (error instanceof BriefUnavailableError) return failure("data_unavailable", 503, requestId, undefined, { missing: error.missing });
    if (error instanceof MarketDataError) return failure(error.code, error.status, requestId);
    logError("narrative_route_internal_error", { requestId });
    return failure("INTERNAL_ERROR", 500, requestId);
  }
}
