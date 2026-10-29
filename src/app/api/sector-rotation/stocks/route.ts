import { marketRoute } from "@/server/http";
import { stockSectorRotationIntervalSchema } from "@/server/schemas/idx-bei";
import { optionalParam } from "@/server/schemas/inputs";
import { z } from "zod";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "stock-sector-rotation", cacheControl: "private, max-age=300" }, (source) => {
    const params = new URL(request.url).searchParams;
    const sector = z.string().trim().min(1).max(80).parse(optionalParam(params, "sector") ?? "");
    const interval = optionalParam(params, "interval");
    return source.stockSectorRotation({
      sector,
      interval: interval ? stockSectorRotationIntervalSchema.parse(interval.toLowerCase()) : undefined,
    }, request.signal);
  });
}
