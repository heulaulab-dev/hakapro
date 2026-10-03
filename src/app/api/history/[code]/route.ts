import { z } from "zod";
import { marketRoute } from "@/server/http";
import { optionalParam, positiveInt, symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/history/[code]">) {
  return marketRoute(request, { endpoint: "history" }, async (source) => {
    const code = symbolSchema.parse((await context.params).code);
    const p = new URL(request.url).searchParams;
    const limit = optionalParam(p, "limit"), frame = optionalParam(p, "frame");
    return source.history(code, { limit: limit ? positiveInt.max(5000).parse(limit) : undefined, frame: frame ? z.enum(["daily", "weekly", "monthly"]).parse(frame) : undefined }, request.signal);
  });
}
