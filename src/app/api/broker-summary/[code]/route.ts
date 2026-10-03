import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/broker-summary/[code]">) {
  return marketRoute(request, { endpoint: "broker-summary" }, async (source) => source.brokerSummary(symbolSchema.parse((await context.params).code), request.signal));
}
