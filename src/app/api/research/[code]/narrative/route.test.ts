import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { BASELINE_DIR, wib } from "../../../../../../tests/support/fixtures";
import { setAnthropicClientForTests } from "@/server/ai/client";
import { clearNarrativeCache } from "@/server/ai/narrative";
import { clearAiQuota } from "@/server/ai/quota";
import { mockClient, parsedMessage } from "@/server/ai/test-support";
import { FixtureSource } from "@/server/market/fixture-source";
import { clearResearchCache } from "@/server/services/research-brief";

const access = vi.hoisted(() => ({ decision: "allow" as "allow" | "unauthorized" }));
const source = new FixtureSource(() => wib("2026-10-21T17:00:00"), BASELINE_DIR);
vi.mock("@/server/auth", () => ({ checkAccess: async () => access.decision }));
vi.mock("@/server/viewer", () => ({ getViewer: async () => ({ kind: "user", id: "u-1", email: "a@example.com" }) }));
vi.mock("@/server/market", async (importOriginal) => ({ ...(await importOriginal<object>()), getMarketDataSource: () => source }));

const KEY = "sk-ant-route-test-key";

async function get(code: string, query = "?lang=id") {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/research/${code}/narrative${query}`, { headers: { "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}` } }), { params: Promise.resolve({ code }) });
}

// The first import compiles the route and the SDK; keep it out of the per-test timeout.
beforeAll(async () => { await import("./route"); }, 60_000);
beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  access.decision = "allow";
  delete process.env.AI_FEATURES_ENABLED;
  delete process.env.ANTHROPIC_API_KEY;
  setAnthropicClientForTests(null);
  clearResearchCache();
  clearNarrativeCache();
  clearAiQuota();
  vi.restoreAllMocks();
});

describe("GET /api/research/[code]/narrative", () => {
  test("503 AI_NOT_CONFIGURED while AI is off (the default), without calling the model", async () => {
    const { client, parse } = mockClient();
    setAnthropicClientForTests(client);
    const response = await get("BBCA");
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "AI_NOT_CONFIGURED", reason: "DISABLED" });
    process.env.AI_FEATURES_ENABLED = "1";
    expect(await (await get("BBCA")).json()).toMatchObject({ error: "AI_NOT_CONFIGURED", reason: "MISSING_KEY" });
    expect(parse).not.toHaveBeenCalled();
  });

  test("401 before anything else when not signed in", async () => {
    access.decision = "unauthorized";
    expect((await get("BBCA")).status).toBe(401);
  });

  describe("with AI on", () => {
    beforeEach(() => {
      process.env.AI_FEATURES_ENABLED = "1";
      process.env.ANTHROPIC_API_KEY = KEY;
    });

    test("200 rejected (no sentences, not charged) when the model invents a number", async () => {
      const { client } = mockClient({ parse: async () => parsedMessage(["Harga BBCA Rp123.456.", "Data lain tersedia.", "Tidak ada yang lain."]) });
      setAnthropicClientForTests(client);
      const response = await get("BBCA");
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ status: "rejected", reason: "UNVERIFIED_NUMBERS", sentences: null, code: "BBCA", lang: "id", quota: { used: 0, charged: false } });
      expect(JSON.stringify(body)).not.toContain(KEY);
    });

    test("200 ok with sentences built only from the brief", async () => {
      const { client, parse } = mockClient({ parse: async (params: unknown) => {
        const facts = JSON.parse((params as { messages: Array<{ content: string }> }).messages[0].content);
        return parsedMessage([
          `Harga terakhir ${facts.stock.code} tercatat untuk sesi ${facts.session}.`,
          "Bagian bukti yang datanya tersedia ditampilkan di bawah.",
          "Data yang tidak tersedia ditandai pada halaman.",
        ]);
      } });
      setAnthropicClientForTests(client);
      const response = await get("BBCA", "?lang=en");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "ok", lang: "en", sentences: expect.arrayContaining([expect.stringContaining("BBCA")]), quota: { used: 1, charged: true } });
      expect(parse).toHaveBeenCalledTimes(1);
    });

    test("400 for an unknown language, 404 for an unknown ticker", async () => {
      expect((await get("BBCA", "?lang=fr")).status).toBe(400);
      setAnthropicClientForTests(mockClient().client);
      expect((await get("ZZZZ")).status).toBe(404);
    });
  });
});
