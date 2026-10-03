import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api/envelope";

/** Errors that a retry cannot fix: configuration and capability, not transient provider trouble. */
const PERMANENT = new Set(["UNSUPPORTED", "NOT_CONFIGURED", "AUTH_NOT_CONFIGURED", "NOT_RECORDED", "PROVIDER_UNAUTHORIZED", "MALFORMED_PROVIDER_RESPONSE", "MALFORMED_RESPONSE"]);

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && (error.status < 500 || PERMANENT.has(error.code))) return false;
  return failureCount < 2;
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: shouldRetry },
    },
  });
}
