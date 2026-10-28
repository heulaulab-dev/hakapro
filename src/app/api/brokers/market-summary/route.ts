import { marketRoute } from "@/server/http";

// IDX market-wide GetBrokerSummary totals (date×broker); the [code] route remains stock-specific.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? undefined;
  const to = params.get("to") ?? undefined;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  return marketRoute(request, { endpoint: "broker-market-summary", cacheControl: "private, max-age=300" }, (source) =>
    source.marketBrokerSummary({ from, to, limit }, request.signal));
}
