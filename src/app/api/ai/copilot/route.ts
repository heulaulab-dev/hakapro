import { z } from "zod";
import { failure } from "@/server/http";
import { logError } from "@/server/log";
import { getMarketDataSource } from "@/server/market";
import { startCopilot } from "@/server/ai/copilot";
import { aiFailure, guardAiRequest } from "@/server/ai/route-helpers";

export const runtime = "nodejs";

const bodySchema = z.object({
  lang: z.enum(["id", "en"]),
  messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) })).min(1).max(12)
    .refine((turns) => turns.at(-1)?.role === "user", "the last message must be the user's question"),
});

/**
 * POST /api/ai/copilot — PROTOTYPE copilot (same AI_FEATURES_ENABLED flag). Body `{ lang, messages }`; answers as
 * NDJSON events: `tool` (a data lookup started), `text` (answer delta, a draft until `done`), `retract` (hide the
 * draft: unverified number, advice wording, refusal or truncation), `done` (with citations), `error`.
 * 401/429/503 errors are plain JSON before any streaming starts.
 */
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const gate = await guardAiRequest(request, { endpoint: "ai-copilot", limit: 10 }, requestId);
  if (gate.response) return gate.response;
  // JSON only: a cross-site form cannot send this content type without a CORS preflight.
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return failure("UNSUPPORTED_MEDIA_TYPE", 415, requestId);
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return failure("INVALID_REQUEST", 400, requestId);

  let events: AsyncGenerator<unknown>;
  try {
    events = startCopilot({ turns: body.data.messages, lang: body.data.lang }, { config: gate.config, userKey: gate.userKey, source: getMarketDataSource(), signal: request.signal });
  } catch (error) {
    const ai = aiFailure(error, requestId);
    if (ai) return ai;
    logError("copilot_route_internal_error", { requestId });
    return failure("INTERNAL_ERROR", 500, requestId);
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await events.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
    },
    async cancel() {
      await events.return(undefined);
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-request-id": requestId } });
}
