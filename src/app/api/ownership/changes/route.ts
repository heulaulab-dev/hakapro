import { marketRoute } from "@/server/http";
import { optionalParam, symbolSchema } from "@/server/schemas/inputs";
import { ownershipMonthSchema } from "@/server/schemas/ownership";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "ownership-changes", limit: 30, cacheControl: "private, max-age=300" }, (source) => {
    const p = new URL(request.url).searchParams;
    const month = optionalParam(p, "month"), symbol = optionalParam(p, "symbol");
    return source.ownershipChanges({ month: month ? ownershipMonthSchema.parse(month) : undefined, symbol: symbol ? symbolSchema.parse(symbol) : undefined });
  });
}
