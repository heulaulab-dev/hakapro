import { marketRoute } from "@/server/http";
import { groupWindowSchema } from "@/server/schemas/idx-bei";
import { optionalParam } from "@/server/schemas/inputs";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "groups", cacheControl: "private, max-age=60" }, (source) => {
    const window = optionalParam(new URL(request.url).searchParams, "window");
    return source.groups({ window: window ? groupWindowSchema.parse(window.toUpperCase()) : undefined });
  });
}
