import { marketRoute } from "@/server/http";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "ownership-stealth", limit: 30, cacheControl: "private, max-age=300" }, (source) => source.stealthOwnership());
}
