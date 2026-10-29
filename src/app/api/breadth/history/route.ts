import { marketRoute } from "@/server/http";
import { breadthHistoryWindowSchema } from "@/server/schemas/market-intelligence";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "breadth-history", cacheControl: "private, max-age=300" }, (source) => {
    const window = breadthHistoryWindowSchema.parse(new URL(request.url).searchParams.get("window")?.toUpperCase() ?? "3M");
    return source.breadthHistory(window);
  });
}
