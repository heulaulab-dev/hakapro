import { z } from "zod";
import { marketRoute } from "@/server/http";
import { optionalParam, positiveInt, symbolSchema } from "@/server/schemas/inputs";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";

export async function GET(request: Request, context: RouteContext<"/api/history/[code]">) {
  return marketRoute(request, { endpoint: "history" }, async (source) => {
    const code = symbolSchema.parse((await context.params).code);
    const p = new URL(request.url).searchParams;
    const limit = optionalParam(p, "limit"), frame = optionalParam(p, "frame");
    return source.history(code, { limit: limit ? positiveInt.min(ARJUM_LIMITS.historyMinRows).max(ARJUM_LIMITS.historyRows).parse(limit) : undefined, frame: frame ? z.enum(["daily", "weekly", "monthly"]).parse(frame) : undefined }, request.signal);
  });
}
