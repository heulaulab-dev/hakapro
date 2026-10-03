import { marketRoute } from "@/server/http";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "foreign-flow", limit: 10, cacheControl: "private, max-age=300" }, (source) => source.foreignFlow());
}
