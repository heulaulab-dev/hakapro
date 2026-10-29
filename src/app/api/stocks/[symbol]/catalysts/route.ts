import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/stocks/[symbol]/catalysts">) {
  return marketRoute(request, { endpoint: "catalysts", cacheControl: "private, max-age=300" }, async (source) => source.catalysts(symbolSchema.parse((await context.params).symbol)));
}
