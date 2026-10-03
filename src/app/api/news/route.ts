import { marketRoute } from "@/server/http";
import { optionalParam, positiveInt } from "@/server/schemas/inputs";

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "news", limit: 30, cacheControl: "private, max-age=300" }, (source) => {
    const p = new URL(request.url).searchParams;
    const page = optionalParam(p, "page"), perPage = optionalParam(p, "per_page");
    return source.news({ page: page ? positiveInt.max(20).parse(page) : undefined, perPage: perPage ? positiveInt.max(100).parse(perPage) : undefined });
  });
}
