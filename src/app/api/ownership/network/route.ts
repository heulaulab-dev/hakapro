import { marketRoute } from "@/server/http";
import { optionalParam } from "@/server/schemas/inputs";
import { ownershipMonthSchema } from "@/server/schemas/ownership";
import { MarketDataError } from "@/server/market/errors";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "ownership-network", limit: 30, cacheControl: "private, no-store" }, (source) => {
    const month = optionalParam(new URL(request.url).searchParams, "month");
    const parsed = month ? ownershipMonthSchema.safeParse(month) : undefined;
    if (parsed && !parsed.success) throw new MarketDataError("INVALID_REQUEST", "Invalid request", 400);
    return source.ownershipNetwork({ month: parsed?.success ? parsed.data : undefined });
  });
}
