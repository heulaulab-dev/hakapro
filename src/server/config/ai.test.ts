import { describe, expect, test } from "vitest";
import { AI_DEFAULT_DAILY_LIMIT, AI_DEFAULT_MODELS, AiNotConfiguredError, isAiEnabled, requireAiConfig, resolveAiConfig } from "./ai";

const KEY = "sk-ant-test-secret-value";

describe("resolveAiConfig", () => {
  test("off by default, even with a key", () => {
    expect(resolveAiConfig({})).toMatchObject({ enabled: false, reason: "DISABLED" });
    expect(resolveAiConfig({ ANTHROPIC_API_KEY: KEY })).toMatchObject({ enabled: false, reason: "DISABLED" });
    expect(resolveAiConfig({ AI_FEATURES_ENABLED: "true", ANTHROPIC_API_KEY: KEY })).toMatchObject({ enabled: false, reason: "DISABLED" });
  });
  test("the flag without a key is MISSING_KEY", () => {
    expect(resolveAiConfig({ AI_FEATURES_ENABLED: "1" })).toMatchObject({ enabled: false, reason: "MISSING_KEY" });
    expect(resolveAiConfig({ AI_FEATURES_ENABLED: "1", ANTHROPIC_API_KEY: "  " })).toMatchObject({ enabled: false, reason: "MISSING_KEY" });
  });
  test("flag and key: on, with the default models and limit", () => {
    const status = resolveAiConfig({ AI_FEATURES_ENABLED: "1", ANTHROPIC_API_KEY: KEY });
    expect(status).toMatchObject({ enabled: true, config: { apiKey: KEY, models: AI_DEFAULT_MODELS, dailyLimit: AI_DEFAULT_DAILY_LIMIT } });
    expect(AI_DEFAULT_MODELS).toEqual({ narrative: "claude-opus-5-5", copilot: "claude-opus-5-5" });
  });
  test("model and limit overrides, validated", () => {
    const env = { AI_FEATURES_ENABLED: "1", ANTHROPIC_API_KEY: KEY, AI_MODEL_NARRATIVE: "claude-haiku-5-5", AI_MODEL_COPILOT: "claude-sonnet-5-5", AI_DAILY_REQUEST_LIMIT: "50" };
    expect(resolveAiConfig(env)).toMatchObject({ enabled: true, config: { models: { narrative: "claude-haiku-5-5", copilot: "claude-sonnet-5-5" }, dailyLimit: 50 } });
    expect(resolveAiConfig({ ...env, AI_MODEL_COPILOT: "Claude Opus!" })).toMatchObject({ enabled: false, reason: "INVALID_CONFIG" });
    expect(resolveAiConfig({ ...env, AI_DAILY_REQUEST_LIMIT: "0" })).toMatchObject({ enabled: false, reason: "INVALID_CONFIG" });
    expect(resolveAiConfig({ ...env, AI_DAILY_REQUEST_LIMIT: "2.5" })).toMatchObject({ enabled: false, reason: "INVALID_CONFIG" });
  });
  test("errors name the setting, never the key", () => {
    expect(isAiEnabled({ AI_FEATURES_ENABLED: "1" })).toBe(false);
    expect(() => requireAiConfig({ AI_FEATURES_ENABLED: "1" })).toThrow(AiNotConfiguredError);
    try {
      requireAiConfig({ AI_FEATURES_ENABLED: "1", ANTHROPIC_API_KEY: KEY, AI_DAILY_REQUEST_LIMIT: "x" });
    } catch (error) {
      expect(error).toMatchObject({ code: "AI_NOT_CONFIGURED", reason: "INVALID_CONFIG" });
      expect(String((error as Error).message)).not.toContain(KEY);
    }
  });
});
