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

/**
 * E2E_RATE_LIMIT_SCALE multiplies per-route limits for the local e2e server, where every test shares
 * one IP. Ignored in production.
 */
function rateLimitScale(): number {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") return 1;
  const scale = Number(process.env.E2E_RATE_LIMIT_SCALE);
  return Number.isFinite(scale) && scale >= 1 ? scale : 1;
}

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

/** Uniform error body. `extra` adds route-specific fields (e.g. which components are missing). */
export function failure(code: string, status: number, requestId: string, headers?: HeadersInit, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: code, requestId, data: null, freshness: "UNAVAILABLE", asOf: null, source: "none", ...extra },
    { status, headers: { "cache-control": "no-store", "x-request-id": requestId, ...headers } },
  );
}

type RouteOptions = { endpoint: string; limit?: number; cacheControl?: string };

/** Rate limit → auth (fails closed). Returns the error response to send, or null when the request may proceed. */
export async function guardRequest(request: Request, options: Pick<RouteOptions, "endpoint" | "limit">, requestId: string): Promise<NextResponse | null> {
  if (!allowRequest(clientKey(request, options.endpoint), (options.limit ?? 60) * rateLimitScale())) return failure("RATE_LIMITED", 429, requestId);
  const access = await checkAccess().catch(() => "unauthorized" as const);
  if (access === "not_configured") return failure("AUTH_NOT_CONFIGURED", 503, requestId);
  if (access !== "allow") return failure("UNAUTHORIZED", 401, requestId);
  return null;
}

/** Wraps a market route: rate limit → auth (fails closed) → run → freshness envelope JSON, with uniform error mapping. */
export async function marketRoute(
  request: Request,
  options: RouteOptions,
  run: (source: MarketDataSource) => Promise<WithFreshness<unknown>>,
) {
  const requestId = crypto.randomUUID();
  const denied = await guardRequest(request, options, requestId);
  if (denied) return denied;
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
