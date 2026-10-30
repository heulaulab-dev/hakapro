import { marketRoute } from "@/server/http";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "foreign-flow-pulse", cacheControl: "private, max-age=300" }, (source) => source.foreignFlowPulse());
}
