import { marketRoute } from "@/server/http";
import { dateSchema, optionalParam, positiveInt, symbolSchema } from "@/server/schemas/inputs";

export async function GET(request: Request, context: RouteContext<"/api/broker-accumulation/[code]">) {
  return marketRoute(request, { endpoint: "broker-accumulation" }, async (source) => {
    const code = symbolSchema.parse((await context.params).code);
    const p = new URL(request.url).searchParams;
    const startDate = optionalParam(p, "start_date"), endDate = optionalParam(p, "end_date"), top = optionalParam(p, "top");
    return source.brokerAccumulation(code, {
      startDate: startDate ? dateSchema.parse(startDate) : undefined,
      endDate: endDate ? dateSchema.parse(endDate) : undefined,
      top: top ? positiveInt.max(50).parse(top) : undefined,
      brokers: optionalParam(p, "brokers")?.split(",").filter(Boolean).map((broker) => symbolSchema.parse(broker)),
    }, request.signal);
  });
}
