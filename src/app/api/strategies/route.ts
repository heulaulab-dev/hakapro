import { marketRoute } from "@/server/http";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "strategies", limit: 30 }, (source) => source.strategies(request.signal));
}
