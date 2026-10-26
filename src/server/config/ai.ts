import "server-only";

/**
 * AI features (Claude API). Off unless AI_FEATURES_ENABLED=1 AND ANTHROPIC_API_KEY is set at runtime.
 * The key is a runtime-only secret (Coolify); it is never read at build time, never logged, never sent
 * to the browser, and never echoed in an error. Everything here is resolved per request, so setting or
 * removing the secret takes effect on the next request without a rebuild.
 */

/** Defaults from the Claude API guidance (current Opus). Override per feature with AI_MODEL_NARRATIVE / AI_MODEL_COPILOT. */
export const AI_DEFAULT_MODELS = { narrative: "claude-opus-5-5", copilot: "claude-opus-5-5" } as const;
/** AI requests per signed-in user per Jakarta day, shared by every AI feature. */
export const AI_DEFAULT_DAILY_LIMIT = 20;
const MAX_DAILY_LIMIT = 1000;
/** Per-request timeout (ms) and SDK retries (408/409/429/5xx and connection errors). Retries multiply wall-clock. */
export const AI_TIMEOUT_MS = 45_000;
export const AI_MAX_RETRIES = 2;
/** Copilot tool-loop cap: at most this many model turns per question (the last one may not call tools). */
export const AI_COPILOT_MAX_ITERATIONS = 5;

export type AiFeature = keyof typeof AI_DEFAULT_MODELS;

export type AiConfig = {
  apiKey: string;
  models: Record<AiFeature, string>;
  dailyLimit: number;
  timeoutMs: number;
  maxRetries: number;
  copilotMaxIterations: number;
};

/** Why AI is off: the flag is not "1", the key is absent, or a non-secret setting is malformed. */
export type AiDisabledReason = "DISABLED" | "MISSING_KEY" | "INVALID_CONFIG";
export type AiStatus = { enabled: true; config: AiConfig } | { enabled: false; reason: AiDisabledReason; detail: string };

/** Thrown when an AI feature is called while AI is off. Routes map it to 503 AI_NOT_CONFIGURED. */
export class AiNotConfiguredError extends Error {
  readonly code = "AI_NOT_CONFIGURED";
  constructor(readonly reason: AiDisabledReason, detail: string) {
    super(`AI features are not configured: ${detail}`);
    this.name = "AiNotConfiguredError";
  }
}

type Env = Record<string, string | undefined>;

// Model ids are short lowercase slugs such as "claude-opus-5-5"; anything else is a typo, not a model.
const MODEL_ID = /^[a-z][a-z0-9.-]{2,63}$/;

function model(env: Env, name: string, fallback: string): string | null {
  const value = env[name]?.trim();
  if (!value) return fallback;
  return MODEL_ID.test(value) ? value : null;
}

export function resolveAiConfig(env: Env = process.env): AiStatus {
  if (env.AI_FEATURES_ENABLED?.trim() !== "1") return { enabled: false, reason: "DISABLED", detail: "AI_FEATURES_ENABLED is not 1" };
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { enabled: false, reason: "MISSING_KEY", detail: "ANTHROPIC_API_KEY is not set" };
  const narrative = model(env, "AI_MODEL_NARRATIVE", AI_DEFAULT_MODELS.narrative);
  if (!narrative) return { enabled: false, reason: "INVALID_CONFIG", detail: "AI_MODEL_NARRATIVE is not a model id" };
  const copilot = model(env, "AI_MODEL_COPILOT", AI_DEFAULT_MODELS.copilot);
  if (!copilot) return { enabled: false, reason: "INVALID_CONFIG", detail: "AI_MODEL_COPILOT is not a model id" };
  const rawLimit = env.AI_DAILY_REQUEST_LIMIT?.trim();
  const dailyLimit = rawLimit ? Number(rawLimit) : AI_DEFAULT_DAILY_LIMIT;
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > MAX_DAILY_LIMIT) {
    return { enabled: false, reason: "INVALID_CONFIG", detail: `AI_DAILY_REQUEST_LIMIT must be an integer from 1 to ${MAX_DAILY_LIMIT}` };
  }
  return {
    enabled: true,
    config: { apiKey, models: { narrative, copilot }, dailyLimit, timeoutMs: AI_TIMEOUT_MS, maxRetries: AI_MAX_RETRIES, copilotMaxIterations: AI_COPILOT_MAX_ITERATIONS },
  };
}

export function isAiEnabled(env: Env = process.env): boolean {
  return resolveAiConfig(env).enabled;
}

/** The config, or AiNotConfiguredError naming the missing setting (never its value). */
export function requireAiConfig(env: Env = process.env): AiConfig {
  const status = resolveAiConfig(env);
  if (!status.enabled) throw new AiNotConfiguredError(status.reason, status.detail);
  return status.config;
}
