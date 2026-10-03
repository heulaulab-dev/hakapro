// Ported from heulatrade lib/api/http.ts + lib/market/arjum/route.ts.
import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import type { WithFreshness } from "@/lib/freshness";
import { checkAccess } from "@/server/auth";
import { logError } from "@/server/log";
import { getMarketDataSource, type MarketDataSource } from "@/server/market";
import { MarketDataError } from "@/server/market/errors";

const windows = new Map<string, { count: number; reset: number }>();

/** Per-instance fixed window. Good enough for one Node process; not a distributed limiter. */
export function allowRequest(key: string, limit = 60, now = Date.now()): boolean {
  const entry = windows.get(key);
  if (!entry || entry.reset <= now) {
    windows.set(key, { count: 1, reset: now + 60_000 });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
}

function clientKey(request: Request, endpoint: string): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `${endpoint}:${ip}`;
}

function failure(code: string, status: number, requestId: string, headers?: HeadersInit) {
  return NextResponse.json(
    { error: code, requestId, data: null, freshness: "UNAVAILABLE", asOf: null, source: "none" },
    { status, headers: { "cache-control": "no-store", "x-request-id": requestId, ...headers } },
  );
}

type RouteOptions = { endpoint: string; limit?: number; cacheControl?: string };

/** Wraps a market route: rate limit → auth (fails closed) → run → freshness envelope JSON, with uniform error mapping. */
export async function marketRoute(
  request: Request,
  options: RouteOptions,
  run: (source: MarketDataSource) => Promise<WithFreshness<unknown>>,
) {
  const requestId = crypto.randomUUID();
  if (!allowRequest(clientKey(request, options.endpoint), options.limit ?? 60)) return failure("RATE_LIMITED", 429, requestId);
  const access = await checkAccess().catch(() => "unauthorized" as const);
  if (access === "not_configured") return failure("AUTH_NOT_CONFIGURED", 503, requestId);
  if (access !== "allow") return failure("UNAUTHORIZED", 401, requestId);
  try {
    const body = await run(getMarketDataSource());
    return NextResponse.json(body, { headers: { "cache-control": options.cacheControl ?? "private, no-store", "x-request-id": requestId } });
  } catch (error) {
    if (error instanceof ZodError) return failure("INVALID_REQUEST", 400, requestId);
    if (error instanceof MarketDataError) {
      return failure(error.code, error.status, requestId, error.retryAfterSeconds ? { "retry-after": String(error.retryAfterSeconds) } : undefined);
    }
    logError("market_route_internal_error", { requestId, endpoint: options.endpoint });
    return failure("INTERNAL_ERROR", 500, requestId);
  }
}
