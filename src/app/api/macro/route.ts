import { marketRoute } from "@/server/http";

// BI-Rate, JISDOR and World Bank commodity prices (`/v1/macro`). Updates daily (rates) to monthly (commodities), so a
// short private cache is plenty.
export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "macro", cacheControl: "private, max-age=300" }, (source) => source.macro());
}
