import { z } from "zod";
import { marketRoute } from "@/server/http";
import { optionalParam, positiveInt, symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/financial-statements/[code]">) {
  return marketRoute(request, { endpoint: "financial-statements" }, async (source) => {
    const code = symbolSchema.parse((await context.params).code);
    const p = new URL(request.url).searchParams;
    const limit = optionalParam(p, "limit");
    return source.financialStatements(code, {
      reportType: z.enum(["INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW"]).optional().parse(optionalParam(p, "report_type")),
      period: z.enum(["quarterly", "annual"]).optional().parse(optionalParam(p, "period")),
      limit: limit ? positiveInt.max(40).parse(limit) : undefined,
      year: z.string().regex(/^\d{4}$/).optional().parse(optionalParam(p, "year")),
    }, request.signal);
  });
}
