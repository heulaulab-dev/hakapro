import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/stocks/[symbol]/dividend-patterns">) {
  return marketRoute(request, { endpoint: "dividend-patterns", cacheControl: "private, max-age=300" }, async (source) =>
    source.dividendPatterns(symbolSchema.parse((await context.params).symbol)));
}
