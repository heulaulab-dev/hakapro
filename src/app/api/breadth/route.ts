import { marketRoute } from "@/server/http";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "breadth", cacheControl: "private, max-age=300" }, async (source) => source.breadth());
}
