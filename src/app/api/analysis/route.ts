import { z } from "zod";
import { marketRoute } from "@/server/http";
import { symbolSchema } from "@/server/schemas/inputs";
import { ANALYSIS_BATCH_MAX } from "@/lib/api/provider-limits";
import { compareAnalyses } from "@/server/services/analysis-compare";

const symbolsSchema = z.string().trim().min(1).transform((value) => [...new Set(value.split(",").map((part) => symbolSchema.parse(part)))]).pipe(z.array(z.string()).min(1).max(ANALYSIS_BATCH_MAX));

/** Several analyses for comparison: `?symbols=BBCA,BBRI` (max 5; one provider request each, sequential). */
export async function GET(request: Request) {
  return marketRoute(request, { endpoint: "analysis-compare", limit: 10 }, (source) => compareAnalyses(source, symbolsSchema.parse(new URL(request.url).searchParams.get("symbols")), request.signal));
}
