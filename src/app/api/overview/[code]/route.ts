import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";
import { getStockOverview } from "@/server/services/stock-overview";

export async function GET(request: Request, context: RouteContext<"/api/overview/[code]">) {
  return marketRoute(request, { endpoint: "overview", limit: 60 }, async (source) => getStockOverview(source, symbolSchema.parse((await context.params).code), request.signal));
}
