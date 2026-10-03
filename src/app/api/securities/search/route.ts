import { z } from "zod";
import { marketRoute } from "@/server/http";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "security-search", limit: 30 }, (source) =>
    source.securities(z.string().trim().max(80).parse(new URL(request.url).searchParams.get("q") ?? "")));
}
