import { guardRequest } from "@/server/http";
import { logError } from "@/server/log";
import { getMarketDataSource } from "@/server/market";
import { MarketDataError } from "@/server/market/errors";
import { symbolSchema } from "@/server/schemas/inputs";

// Ticker logo proxy (HAKA-74): the Data Engine's sanitized SVG served from our own origin, because the app CSP
// (`img-src 'self' data: blob:`) does not allow hotlinking TradingView's CDN. Not `marketRoute`: the body is an image,
// not a freshness envelope. Contract with the UI: 200 image/svg+xml, anything else means "show the monogram".
// Off unless the engine runs with ENGINE_TICKER_LOGOS_ENABLED=true (and the UI with NEXT_PUBLIC_TICKER_LOGOS=1);
// arjum-only and fixture lanes have no engine and answer 404.

const LOGO_RESPONSE_HEADERS = {
  "content-type": "image/svg+xml; charset=utf-8",
  "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
  "x-content-type-options": "nosniff",
  // Opened directly, the SVG is an inert document: no script, no network loads, inline styles only.
  "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
} as const;

/** Miss: a short private cache so a logo-less ticker is not re-requested on every render. */
const notFound = (requestId: string) =>
  new Response(null, { status: 404, headers: { "cache-control": "private, max-age=300", "x-request-id": requestId } });

export async function GET(request: Request, context: RouteContext<"/api/logos/[symbol]">) {
  const requestId = crypto.randomUUID();
  // A page can show dozens of tickers at once, so the window is wider than the JSON routes'.
  const denied = await guardRequest(request, { endpoint: "logos", limit: 600 }, requestId);
  if (denied) return denied;
  const symbol = symbolSchema.safeParse((await context.params).symbol);
  if (!symbol.success) return new Response(null, { status: 400, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  try {
    const logo = await getMarketDataSource().logo(symbol.data, request.signal);
    if (!logo) return notFound(requestId);
    return new Response(logo.svg, { status: 200, headers: { ...LOGO_RESPONSE_HEADERS, "x-request-id": requestId } });
  } catch (error) {
    // No engine behind this lane (fixture, arjum only, or no MARKET_API_URL): there is simply no logo.
    if (error instanceof MarketDataError && (error.code === "UNSUPPORTED" || error.code === "NOT_CONFIGURED")) return notFound(requestId);
    if (!(error instanceof MarketDataError)) logError("logo_route_internal_error", { requestId });
    return new Response(null, { status: error instanceof MarketDataError && error.status < 500 ? error.status : 503, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  }
}
