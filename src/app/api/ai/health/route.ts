import { NextResponse } from "next/server";
import { isAdmin } from "@/server/admin";
import { classifyAiError, getAnthropicClient } from "@/server/ai/client";
import { ATTEMPT_MULTIPLIER } from "@/server/ai/quota";
import { resolveAiConfig } from "@/server/config/ai";

export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * GET /api/ai/health[?probe=1] — admin only (everyone else gets the same 404 as a missing route).
 * Reports whether AI is configured and with which non-secret settings; never the key or any part of it.
 * `probe=1` also checks that the key works with one Models API lookup (no tokens are generated or billed).
 */
export async function GET(request: Request) {
  if (!(await isAdmin().catch(() => false))) return json({ error: "NOT_FOUND" }, 404);
  const status = resolveAiConfig();
  if (!status.enabled) {
    return json({ configured: false, reason: status.reason, detail: status.detail, flag: process.env.AI_FEATURES_ENABLED?.trim() === "1", keyPresent: Boolean(process.env.ANTHROPIC_API_KEY?.trim()) });
  }
  const { config } = status;
  const body: Record<string, unknown> = {
    configured: true, flag: true, keyPresent: true,
    models: config.models, dailyLimit: config.dailyLimit, attemptLimit: config.dailyLimit * ATTEMPT_MULTIPLIER,
    quotaStore: "memory (per process; resets on restart)", timeoutMs: config.timeoutMs, maxRetries: config.maxRetries, copilotMaxIterations: config.copilotMaxIterations,
  };
  if (new URL(request.url).searchParams.get("probe") === "1") {
    try {
      const model = await getAnthropicClient(config).models.retrieve(config.models.narrative);
      body.probe = { ok: true, model: model.id };
    } catch (error) {
      body.probe = { ok: false, error: classifyAiError(error) };
    }
  }
  return json(body);
}
