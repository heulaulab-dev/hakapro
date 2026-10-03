import { marketRoute } from "@/server/http";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "market", cacheControl: "private, max-age=30" }, (source) => source.marketOverview());
}
