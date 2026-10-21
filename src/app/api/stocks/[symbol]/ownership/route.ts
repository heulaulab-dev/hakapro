import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/stocks/[symbol]/ownership">) {
  return marketRoute(request, { endpoint: "ownership", cacheControl: "private, max-age=300" }, async (source) => source.ownership(symbolSchema.parse((await context.params).symbol)));
}
