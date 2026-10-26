import { marketRoute } from "@/server/http";
import { heatmapLimitSchema } from "@/server/schemas/idx-bei";
import { optionalParam } from "@/server/schemas/inputs";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "heatmap", cacheControl: "private, max-age=60" }, (source) => {
    const limit = optionalParam(new URL(request.url).searchParams, "limit");
    // An invalid limit throws a ZodError → INVALID_REQUEST (400).
    return source.heatmap({ limit: limit === undefined ? undefined : heatmapLimitSchema.parse(limit) });
  });
}
