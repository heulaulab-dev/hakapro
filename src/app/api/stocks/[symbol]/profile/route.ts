import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/stocks/[symbol]/profile">) {
  return marketRoute(request, { endpoint: "profile", cacheControl: "private, max-age=300" }, async (source) => source.profile(symbolSchema.parse((await context.params).symbol)));
}
