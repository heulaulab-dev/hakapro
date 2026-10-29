import { marketRoute } from "@/server/http";
import { issuerRaceWindowSchema } from "@/server/schemas/idx-bei";
import { optionalParam } from "@/server/schemas/inputs";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "issuer-race", cacheControl: "private, max-age=300" }, (source) => {
    const params = new URL(request.url).searchParams;
    const window = optionalParam(params, "window");
    const sector = optionalParam(params, "sector");
    return source.issuerRace({ window: window ? issuerRaceWindowSchema.parse(window.toUpperCase()) : undefined, sector });
  });
}
