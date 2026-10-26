// Market-wide insider feed. A static segment, so it takes precedence over the per-stock `/api/insiders/[code]` route
// (IDX codes are four letters; "recent" is never one).
import { z } from "zod";
import { marketRoute } from "@/server/http";
import { optionalParam, positiveInt } from "@/server/schemas/inputs";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "insiders-recent", limit: 30, cacheControl: "private, max-age=300" }, (source) => {
    const p = new URL(request.url).searchParams;
    const days = optionalParam(p, "days"), limit = optionalParam(p, "limit");
    return source.recentInsiders({
      days: days ? positiveInt.max(30).parse(days) : undefined,
      limit: limit ? positiveInt.max(200).parse(limit) : undefined,
      action: z.enum(["buy", "sell", "cross"]).optional().parse(optionalParam(p, "action")),
    });
  });
}
