import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { BASELINE_DIR, wib } from "../../../../../tests/support/fixtures";
import { setAnthropicClientForTests } from "@/server/ai/client";
import { clearAiQuota } from "@/server/ai/quota";
import { mockClient, streamedTurn } from "@/server/ai/test-support";
import { FixtureSource } from "@/server/market/fixture-source";

const source = new FixtureSource(() => wib("2026-10-21T17:00:00"), BASELINE_DIR);
vi.mock("@/server/auth", () => ({ checkAccess: async () => "allow" }));
vi.mock("@/server/viewer", () => ({ getViewer: async () => ({ kind: "user", id: "u-2", email: null }) }));
vi.mock("@/server/market", async (importOriginal) => ({ ...(await importOriginal<object>()), getMarketDataSource: () => source }));

const post = async (body: unknown, contentType = "application/json") => (await import("./route")).POST(new Request("http://localhost/api/ai/copilot", {
  method: "POST", body: JSON.stringify(body), headers: { "content-type": contentType, "x-forwarded-for": `10.2.0.${Math.floor(Math.random() * 250)}` },
}));
const lines = async (response: Response) => (await response.text()).trim().split("\n").map((line) => JSON.parse(line));

// The first import compiles the route and the SDK; keep it out of the per-test timeout.
beforeAll(async () => { await import("./route"); }, 60_000);
beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.AI_FEATURES_ENABLED;
  delete process.env.ANTHROPIC_API_KEY;
  setAnthropicClientForTests(null);
  clearAiQuota();
  vi.restoreAllMocks();
});

describe("POST /api/ai/copilot", () => {
  test("503 AI_NOT_CONFIGURED by default", async () => {
    const response = await post({ lang: "id", messages: [{ role: "user", content: "Halo" }] });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("AI_NOT_CONFIGURED");
  });

  describe("with AI on", () => {
    beforeEach(() => {
      process.env.AI_FEATURES_ENABLED = "1";
      process.env.ANTHROPIC_API_KEY = "sk-ant-copilot-test";
    });

    test("rejects non-JSON bodies and malformed conversations", async () => {
      expect((await post({ lang: "id", messages: [{ role: "user", content: "Halo" }] }, "text/plain")).status).toBe(415);
      expect((await post({ lang: "id", messages: [] })).status).toBe(400);
      expect((await post({ lang: "id", messages: [{ role: "assistant", content: "Halo" }] })).status).toBe(400);
    });

    test("streams NDJSON events ending with citations", async () => {
      setAnthropicClientForTests(mockClient({ stream: [
        streamedTurn([{ type: "tool_use", id: "t1", name: "get_research_brief", input: { code: "BBCA" } }]),
        streamedTurn([{ type: "text", text: "Saya sudah memeriksa Research Brief BBCA; detailnya ada di sumber yang dikutip." }]),
      ] }).client);
      const response = await post({ lang: "id", messages: [{ role: "user", content: "Harga BBCA?" }] });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/x-ndjson");
      const events = await lines(response);
      expect(events[0]).toEqual({ type: "tool", tool: "get_research_brief", code: "BBCA" });
      expect(events.at(-1)).toMatchObject({ type: "done", charged: true, citations: [{ tool: "get_research_brief", code: "BBCA", asOf: expect.any(String) }] });
    });

    test("advice requests get the fixed refusal", async () => {
      const response = await post({ lang: "en", messages: [{ role: "user", content: "Should I buy BBCA?" }] });
      expect((await lines(response)).at(-1)).toEqual({ type: "done", citations: [], charged: false, refusal: true });
    });
  });
});
