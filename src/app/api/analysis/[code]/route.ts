import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/analysis/[code]">) {
  return marketRoute(request, { endpoint: "analysis", limit: 30 }, async (source) => source.analysis(symbolSchema.parse((await context.params).code), request.signal));
}
