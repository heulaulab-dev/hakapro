import { beforeEach, describe, expect, test } from "vitest";
import { wib } from "../../../tests/support/fixtures";
import { getAnthropicClient, setAnthropicClientForTests } from "./client";
import { aiQuotaStatus, ATTEMPT_MULTIPLIER, clearAiQuota, reserveAiRequest } from "./quota";
import { TEST_CONFIG } from "./test-support";

const NOW = wib("2026-10-21T10:00:00");

beforeEach(() => clearAiQuota());

describe("per-user daily AI limit (in-memory)", () => {
  test("charges on commit only; release frees the slot", () => {
    const first = reserveAiRequest("u", 2, NOW);
    expect(first).toMatchObject({ ok: true, used: 0, remaining: 1 });
    if (!first.ok) throw new Error("unreachable");
    expect(first.release()).toEqual({ used: 0, limit: 2, remaining: 2 });
    const second = reserveAiRequest("u", 2, NOW);
    if (!second.ok) throw new Error("unreachable");
    expect(second.commit()).toEqual({ used: 1, limit: 2, remaining: 1 });
    expect(second.commit()).toEqual({ used: 1, limit: 2, remaining: 1 }); // settling twice is a no-op
  });
  test("pending requests count, so concurrent requests cannot overshoot", () => {
    expect(reserveAiRequest("u", 2, NOW).ok).toBe(true);
    expect(reserveAiRequest("u", 2, NOW).ok).toBe(true);
    expect(reserveAiRequest("u", 2, NOW)).toMatchObject({ ok: false, reason: "QUOTA_EXCEEDED" });
  });
  test("users are independent and the limit resets on the next Jakarta day", () => {
    const held = reserveAiRequest("u", 1, NOW);
    if (held.ok) held.commit();
    expect(reserveAiRequest("u", 1, NOW).ok).toBe(false);
    expect(reserveAiRequest("v", 1, NOW).ok).toBe(true);
    expect(reserveAiRequest("u", 1, wib("2026-10-22T00:01:00")).ok).toBe(true);
  });
  test("failed attempts are free but capped", () => {
    for (let index = 0; index < 2 * ATTEMPT_MULTIPLIER; index += 1) {
      const attempt = reserveAiRequest("u", 2, NOW);
      if (attempt.ok) attempt.release();
    }
    expect(reserveAiRequest("u", 2, NOW)).toMatchObject({ ok: false, reason: "ATTEMPTS_EXCEEDED", used: 0 });
    expect(aiQuotaStatus("u", 2, NOW)).toEqual({ used: 0, limit: 2, remaining: 2 });
  });
});

describe("Anthropic client", () => {
  test("is created lazily from the configured key only and reused", () => {
    setAnthropicClientForTests(null);
    const client = getAnthropicClient(TEST_CONFIG);
    expect(client.apiKey).toBe(TEST_CONFIG.apiKey);
    expect(client.authToken).toBeNull();
    expect(client.maxRetries).toBe(TEST_CONFIG.maxRetries);
    expect(client.timeout).toBe(TEST_CONFIG.timeoutMs);
    expect(getAnthropicClient(TEST_CONFIG)).toBe(client);
    expect(getAnthropicClient({ ...TEST_CONFIG, apiKey: "sk-other" })).not.toBe(client);
  });
});
