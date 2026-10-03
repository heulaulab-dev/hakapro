import { marketRoute } from "@/server/http";
import { dateSchema, optionalParam, positiveInt } from "@/server/schemas/inputs";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "market-cap" }, (source) => {
    const p = new URL(request.url).searchParams;
    const date = optionalParam(p, "date"), page = optionalParam(p, "page"), perPage = optionalParam(p, "per_page");
    return source.marketCap({ date: date ? dateSchema.parse(date) : undefined, page: page ? positiveInt.parse(page) : undefined, perPage: perPage ? positiveInt.max(ARJUM_LIMITS.marketCapPerPage).parse(perPage) : undefined }, request.signal);
  });
}
