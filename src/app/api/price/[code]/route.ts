import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/price/[code]">) {
  return marketRoute(request, { endpoint: "price" }, async (source) => source.price(symbolSchema.parse((await context.params).code), request.signal));
}
