import { z } from "zod";
import { marketRoute } from "@/server/http";
import { dateSchema, optionalParam, positiveInt, symbolSchema } from "@/server/schemas/inputs";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";

export async function GET(request: Request, context: RouteContext<"/api/broker-summary/[code]">) {
  return marketRoute(request, { endpoint: "broker-summary" }, async (source) => {
    const code = symbolSchema.parse((await context.params).code);
    const p = new URL(request.url).searchParams;
    const startDate = optionalParam(p, "start_date"), endDate = optionalParam(p, "end_date");
    const brokerLimit = optionalParam(p, "broker_limit"), levelLimit = optionalParam(p, "level_limit");
    return source.brokerSummary(code, {
      startDate: startDate ? dateSchema.parse(startDate) : undefined,
      endDate: endDate ? dateSchema.parse(endDate) : undefined,
      flow: z.enum(["all", "foreign", "domestic"]).optional().parse(optionalParam(p, "flow")),
      net: z.enum(["true", "false"]).optional().parse(optionalParam(p, "net")) === "true" || undefined,
      brokerLimit: brokerLimit ? positiveInt.max(ARJUM_LIMITS.brokerSummaryRows).parse(brokerLimit) : undefined,
      levelLimit: levelLimit ? positiveInt.max(ARJUM_LIMITS.brokerSummaryRows).parse(levelLimit) : undefined,
    }, request.signal);
  });
}
