import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { AiConfig } from "@/server/config/ai";

/**
 * One lazily created Anthropic client per API key. The key is passed explicitly (never resolved from
 * ANTHROPIC_AUTH_TOKEN or a local `ant` profile), so the server only ever uses the Coolify secret.
 */
let cached: { apiKey: string; client: Anthropic } | null = null;
let override: Anthropic | null = null;

export function getAnthropicClient(config: AiConfig): Anthropic {
  if (override) return override;
  if (cached?.apiKey === config.apiKey) return cached.client;
  const client = new Anthropic({ apiKey: config.apiKey, authToken: null, timeout: config.timeoutMs, maxRetries: config.maxRetries });
  cached = { apiKey: config.apiKey, client };
  return client;
}

/** Tests inject a mocked SDK client here; pass null to restore the real one. */
export function setAnthropicClientForTests(client: Anthropic | null): void {
  override = client;
  cached = null;
}

/**
 * Server-side refusal fallback: when a model's safety classifier declines, the API re-runs the request on
 * Anthropic's recommended model for that refusal category inside the same call. Supported on these models on
 * the Claude API; Haiku has no server-side fallback, so requests to it are sent without the parameter.
 */
export const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01" as const;
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

export function fallbackParams(model: string): { betas: [typeof SERVER_FALLBACK_BETA]; fallbacks: "default" } | Record<string, never> {
  return FALLBACK_MODELS.has(model) ? { betas: [SERVER_FALLBACK_BETA], fallbacks: "default" } : {};
}

/** Classifies an SDK failure for logs and API errors without ever including the message (it may echo input). */
export function classifyAiError(error: unknown): "AI_TIMEOUT" | "AI_RATE_LIMITED" | "AI_AUTH_FAILED" | "AI_BAD_REQUEST" | "AI_UPSTREAM_ERROR" | "AI_UNREACHABLE" {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return "AI_TIMEOUT";
  if (error instanceof Anthropic.APIConnectionError) return "AI_UNREACHABLE";
  if (error instanceof Anthropic.RateLimitError) return "AI_RATE_LIMITED";
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) return "AI_AUTH_FAILED";
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) return "AI_BAD_REQUEST";
  return "AI_UPSTREAM_ERROR";
}

/** Anthropic's metadata.user_id: an opaque per-user hash for abuse tracking, never the email or raw id. */
export async function hashedUserId(userKey: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`hakapro:${userKey}`));
  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
