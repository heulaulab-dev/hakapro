import { marketRoute } from "@/server/http";
import { dateSchema, optionalParam } from "@/server/schemas/inputs";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "actions-calendar", limit: 30, cacheControl: "private, max-age=300" }, (source) => {
    const p = new URL(request.url).searchParams;
    const from = optionalParam(p, "from"), to = optionalParam(p, "to");
    return source.actionsCalendar({ from: from ? dateSchema.parse(from) : undefined, to: to ? dateSchema.parse(to) : undefined });
  });
}
