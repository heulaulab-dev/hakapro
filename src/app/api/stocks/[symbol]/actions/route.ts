import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/stocks/[symbol]/actions">) {
  return marketRoute(request, { endpoint: "actions", cacheControl: "private, max-age=300" }, async (source) => source.corporateActions(symbolSchema.parse((await context.params).symbol)));
}
