import { z } from "zod";
import { marketRoute } from "@/server/http";
import { optionalParam, positiveInt, symbolSchema } from "@/server/schemas/inputs";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";

export async function GET(request: Request, context: RouteContext<"/api/insiders/[code]">) {
  return marketRoute(request, { endpoint: "insiders" }, async (source) => {
    const code = symbolSchema.parse((await context.params).code);
    const p = new URL(request.url).searchParams;
    const page = optionalParam(p, "page"), limit = optionalParam(p, "limit");
    return source.insiders(code, {
      page: page ? positiveInt.parse(page) : undefined,
      limit: limit ? positiveInt.max(ARJUM_LIMITS.insiders).parse(limit) : undefined,
      actionType: z.enum(["buy", "sell", "cross"]).optional().parse(optionalParam(p, "action_type")),
    }, request.signal);
  });
}
