import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/stocks/[symbol]">) {
  return marketRoute(request, { endpoint: "stock", cacheControl: "private, max-age=30" }, async (source) => source.stock(symbolSchema.parse((await context.params).symbol)));
}
