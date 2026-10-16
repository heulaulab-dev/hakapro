import { marketRoute } from "@/server/http";
import { strategyBoard, strategySources } from "@/server/strategies";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "strategies", limit: 30 }, (market) => strategyBoard(strategySources(market), request.signal));
}
