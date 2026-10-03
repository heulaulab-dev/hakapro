import { z } from "zod";
import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";
import { getQuotes, MAX_QUOTES } from "@/server/services/quotes";

const symbolsSchema = z.string().trim().min(1).transform((value) => [...new Set(value.split(",").map((part) => symbolSchema.parse(part)))]).pipe(z.array(z.string()).min(1).max(MAX_QUOTES));

export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "quotes", limit: 60 }, (source) => getQuotes(source, symbolsSchema.parse(new URL(request.url).searchParams.get("symbols")), request.signal));
}
