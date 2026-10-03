import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/seasonal/[code]">) {
  return marketRoute(request, { endpoint: "seasonal" }, async (source) => source.seasonality(symbolSchema.parse((await context.params).code), request.signal));
}
