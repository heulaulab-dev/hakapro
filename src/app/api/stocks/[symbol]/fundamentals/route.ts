import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/stocks/[symbol]/fundamentals">) {
  return marketRoute(request, { endpoint: "fundamentals", cacheControl: "private, max-age=300" }, async (source) => source.fundamentals(symbolSchema.parse((await context.params).symbol)));
}
