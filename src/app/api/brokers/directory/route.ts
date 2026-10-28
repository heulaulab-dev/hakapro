import { marketRoute } from "@/server/http";

// IDX exchange member metadata (code/name/license), separate from per-stock and market-wide trading activity.
export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "broker-directory", cacheControl: "private, max-age=3600" }, (source) => source.brokerDirectory(request.signal));
}
