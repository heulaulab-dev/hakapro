import { marketRoute } from "@/server/http";
import { dateSchema, optionalParam, positiveInt, symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "done-details" }, (source) => {
    const p = new URL(request.url).searchParams;
    const date = optionalParam(p, "date"), page = optionalParam(p, "page"), perPage = optionalParam(p, "per_page");
    return source.doneDetails(symbolSchema.parse(p.get("code")), { date: date ? dateSchema.parse(date) : undefined, page: page ? positiveInt.parse(page) : undefined, perPage: perPage ? positiveInt.max(250).parse(perPage) : undefined }, request.signal);
  });
}
