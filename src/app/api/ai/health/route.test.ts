import { afterEach, describe, expect, test, vi } from "vitest";
import { setAnthropicClientForTests } from "@/server/ai/client";
import { mockClient } from "@/server/ai/test-support";

const admin = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/server/admin", () => ({ isAdmin: async () => admin.allowed }));

const KEY = "sk-ant-health-test-key-123";
const get = async (query = "") => (await import("./route")).GET(new Request(`http://localhost/api/ai/health${query}`));

afterEach(() => {
  admin.allowed = true;
  delete process.env.AI_FEATURES_ENABLED;
  delete process.env.ANTHROPIC_API_KEY;
  setAnthropicClientForTests(null);
});

describe("GET /api/ai/health", () => {
  test("non-admins get a plain 404", async () => {
    admin.allowed = false;
    process.env.AI_FEATURES_ENABLED = "1";
    process.env.ANTHROPIC_API_KEY = KEY;
    expect((await get()).status).toBe(404);
  });

  test("reports why AI is off", async () => {
    expect(await (await get()).json()).toMatchObject({ configured: false, reason: "DISABLED", flag: false, keyPresent: false });
    process.env.AI_FEATURES_ENABLED = "1";
    expect(await (await get()).json()).toMatchObject({ configured: false, reason: "MISSING_KEY", flag: true, keyPresent: false });
  });

  test("reports the non-secret settings and an optional key probe, never the key", async () => {
    process.env.AI_FEATURES_ENABLED = "1";
    process.env.ANTHROPIC_API_KEY = KEY;
    const { client } = mockClient();
    setAnthropicClientForTests(client);
    const response = await get("?probe=1");
    const text = await response.text();
    expect(JSON.parse(text)).toMatchObject({ configured: true, keyPresent: true, models: { narrative: "claude-opus-5-5", copilot: "claude-opus-5-5" }, dailyLimit: 20, probe: { ok: true, model: "claude-opus-5-5" } });
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("sk-ant");
  });
});
