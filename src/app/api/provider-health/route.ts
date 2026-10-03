import { marketRoute } from "@/server/http";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "provider-health", limit: 30 }, (source) => source.providerHealth(request.signal));
}
