import { z } from "zod";
import { marketRoute } from "@/server/http";
import { dateSchema, optionalParam, positiveInt, symbolSchema } from "@/server/schemas/inputs";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";

export async function GET(request: Request, context: RouteContext<"/api/history/[code]">) {
  return marketRoute(request, { endpoint: "history" }, async (source) => {
    const code = symbolSchema.parse((await context.params).code);
    const p = new URL(request.url).searchParams;
    const limit = optionalParam(p, "limit"), frame = optionalParam(p, "frame");
    const startDate = optionalParam(p, "start_date"), endDate = optionalParam(p, "end_date");
    return source.history(code, {
      limit: limit ? positiveInt.min(ARJUM_LIMITS.historyMinRows).max(ARJUM_LIMITS.historyRows).parse(limit) : undefined,
      frame: frame ? z.enum(["daily", "weekly", "monthly"]).parse(frame) : undefined,
      startDate: startDate ? dateSchema.parse(startDate) : undefined,
      endDate: endDate ? dateSchema.parse(endDate) : undefined,
    }, request.signal);
  });
}
