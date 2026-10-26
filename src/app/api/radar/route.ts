import { marketRoute } from "@/server/http";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "radar", cacheControl: "private, max-age=60" }, (source) => source.radar());
}
