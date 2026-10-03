import { z } from "zod";
import { marketRoute } from "@/server/http";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "search", limit: 60 }, (source) => {
    const q = z.string().trim().min(1).max(80).parse(new URL(request.url).searchParams.get("q"));
    return source.search(q, request.signal);
  });
}
