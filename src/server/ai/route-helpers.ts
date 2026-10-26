import "server-only";
import { failure, guardRequest } from "@/server/http";
import { AiNotConfiguredError, resolveAiConfig, type AiConfig } from "@/server/config/ai";
import { getViewer } from "@/server/viewer";
import { AiQuotaExceededError, AiRequestError } from "./errors";

/**
 * Shared gate for AI routes: rate limit → auth (fails closed) → AI configured → who is charged.
 * Returns either the response to send or the config plus the quota key of the signed-in user.
 */
export async function guardAiRequest(request: Request, options: { endpoint: string; limit: number }, requestId: string) {
  const denied = await guardRequest(request, options, requestId);
  if (denied) return { response: denied } as const;
  const status = resolveAiConfig();
  // The reason names a setting (never a value) so the owner can tell a missing key from a disabled flag.
  if (!status.enabled) return { response: failure("AI_NOT_CONFIGURED", 503, requestId, undefined, { reason: status.reason }) } as const;
  const viewer = await getViewer();
  const userKey = viewer.kind === "user" ? `user:${viewer.id}` : viewer.kind === "bypass" ? "dev-bypass" : null;
  if (!userKey) return { response: failure("UNAUTHORIZED", 401, requestId) } as const;
  return { config: status.config, userKey } satisfies { config: AiConfig; userKey: string };
}

/** Maps AI errors to responses; anything else is the caller's to handle. */
export function aiFailure(error: unknown, requestId: string) {
  if (error instanceof AiQuotaExceededError) return failure("AI_QUOTA_EXCEEDED", 429, requestId, undefined, { reason: error.reason, quota: error.quota });
  if (error instanceof AiNotConfiguredError) return failure("AI_NOT_CONFIGURED", 503, requestId, undefined, { reason: error.reason });
  if (error instanceof AiRequestError) return failure(error.code, error.code === "AI_RATE_LIMITED" ? 503 : 502, requestId);
  return null;
}
