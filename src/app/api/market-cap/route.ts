import { z } from "zod";
import { marketRoute } from "@/server/http";
import { dateSchema, optionalParam, positiveInt, symbolSchema } from "@/server/schemas/inputs";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";

const symbolsSchema = z.string().transform((value) => [...new Set(value.split(",").filter(Boolean).map((part) => symbolSchema.parse(part)))]).pipe(z.array(z.string()).min(1).max(ARJUM_LIMITS.marketCapCodes));

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "market-cap" }, (source) => {
    const p = new URL(request.url).searchParams;
    const date = optionalParam(p, "date"), page = optionalParam(p, "page"), perPage = optionalParam(p, "per_page"), symbols = optionalParam(p, "symbols");
    return source.marketCap({
      date: date ? dateSchema.parse(date) : undefined,
      page: page ? positiveInt.parse(page) : undefined,
      perPage: perPage ? positiveInt.max(ARJUM_LIMITS.marketCapPerPage).parse(perPage) : undefined,
      symbols: symbols ? symbolsSchema.parse(symbols) : undefined,
    }, request.signal);
  });
}
