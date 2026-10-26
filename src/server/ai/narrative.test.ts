import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { wib } from "../../../tests/support/fixtures";
import { setAnthropicClientForTests } from "./client";
import { AiQuotaExceededError, AiRequestError } from "./errors";
import { checkNarrative, clearNarrativeCache, getBriefNarrative, NARRATIVE_SYSTEM, narrativeFacts } from "./narrative";
import { clearAiQuota } from "./quota";
import { mockClient, parsedMessage, TEST_CONFIG, testBrief } from "./test-support";

// After the close on a trading day: a narrative holds for the settled TTL.
const NOW = wib("2026-10-21T17:00:00");
const context = (userKey = "user:1") => ({ config: TEST_CONFIG, userKey, now: () => NOW });

const GOOD_ID = [
  "Harga terakhir BBCA Rp9.875 per 21 Oktober 2026, turun 1,25% dari penutupan sebelumnya.",
  "Dalam 5 sesi harga naik 3,21%, sementara investor asing mencatat jual bersih 1,2 juta lembar.",
  "Volume sesi terakhir 57,3 juta lembar, 1,84x rata-rata 20 sesi sebelumnya.",
  "Data ringkasan broker dan kepemilikan KSEI belum tersedia.",
];

beforeEach(() => {
  clearNarrativeCache();
  clearAiQuota();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  setAnthropicClientForTests(null);
  vi.restoreAllMocks();
});

describe("narrativeFacts", () => {
  test("keeps the computed facts and drops internal names and personal names", () => {
    const facts = narrativeFacts(testBrief(), "id");
    const json = JSON.stringify(facts);
    expect(facts.price).toEqual({ lastIdr: 9875, changeIdr: -125, changePercent: -1.25 });
    expect(facts.completeness).toEqual({ componentsWithData: 4, componentsTotal: 6 });
    expect(facts.counterEvidence[0]).toContain("3,21%");
    for (const internal of ["arjum", "table", "PROVIDER_UNAVAILABLE", "NOT_UPLOADED", "Budi Santoso", "quota", "generatedAt"]) expect(json).not.toContain(internal);
  });
  test("uses the requested language's counter-evidence", () => {
    expect(narrativeFacts(testBrief(), "en").counterEvidence[0]).toMatch(/^Price rose 3.21%/);
  });
});

describe("checkNarrative", () => {
  const facts = narrativeFacts(testBrief(), "id");
  test("accepts sentences whose numbers all trace to the facts", () => expect(checkNarrative(GOOD_ID, facts)).toEqual({ ok: true }));
  test("rejects an invented number", () => {
    expect(checkNarrative([...GOOD_ID.slice(0, 3), "Target harga Rp11.000 masih jauh."], facts)).toMatchObject({ ok: false, reason: "ADVICE_WORDING" });
    expect(checkNarrative([...GOOD_ID.slice(0, 3), "Nilai transaksi mencapai Rp1,2 T."], facts)).toEqual({ ok: false, reason: "UNVERIFIED_NUMBERS", unknown: 1 });
  });
  test("rejects fewer than 3 or more than 5 sentences", () => {
    expect(checkNarrative(GOOD_ID.slice(0, 2), facts)).toMatchObject({ ok: false, reason: "MALFORMED" });
    expect(checkNarrative([...GOOD_ID, ...GOOD_ID], facts)).toMatchObject({ ok: false, reason: "MALFORMED" });
  });
});

describe("getBriefNarrative", () => {
  test("returns validated sentences, charges once and caches per ticker, session and language", async () => {
    const { client, parse } = mockClient({ parse: async () => parsedMessage(GOOD_ID) });
    setAnthropicClientForTests(client);
    const first = await getBriefNarrative(testBrief(), "id", context());
    expect(first).toMatchObject({ cached: false, charged: true, quota: { used: 1, limit: 3, remaining: 2 } });
    expect(first.outcome).toMatchObject({ status: "ok", narrative: { code: "BBCA", lang: "id", session: "2026-10-21", sentences: GOOD_ID } });
    const again = await getBriefNarrative(testBrief(), "id", context("user:2"));
    expect(again).toMatchObject({ cached: true, charged: false, quota: { used: 0 } });
    expect(parse).toHaveBeenCalledTimes(1);
  });

  test("sends the brief facts once with a cached system prompt, low effort, structured output and refusal fallback", async () => {
    const { client, parse } = mockClient({ parse: async () => parsedMessage(GOOD_ID) });
    setAnthropicClientForTests(client);
    await getBriefNarrative(testBrief(), "en", context());
    const params = parse.mock.calls[0][0] as Record<string, unknown> & { messages: Array<{ content: string }> };
    expect(params).toMatchObject({
      model: "claude-opus-5-5", betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      system: [{ type: "text", text: NARRATIVE_SYSTEM, cache_control: { type: "ephemeral" } }],
      output_config: { effort: "low", format: expect.objectContaining({ type: "json_schema" }) },
      metadata: { user_id: expect.stringMatching(/^[0-9a-f]{32}$/) },
    });
    expect(JSON.parse(params.messages[0].content)).toMatchObject({ language: "en", stock: { code: "BBCA" } });
    expect(JSON.stringify(params)).not.toContain("user:1");
  });

  test("omits the fallback parameter for a model without server-side fallback", async () => {
    const { client, parse } = mockClient({ parse: async () => parsedMessage(GOOD_ID) });
    setAnthropicClientForTests(client);
    await getBriefNarrative(testBrief(), "id", { ...context(), config: { ...TEST_CONFIG, models: { ...TEST_CONFIG.models, narrative: "claude-haiku-5-5" } } });
    expect(parse.mock.calls[0][0]).not.toHaveProperty("fallbacks");
    expect(parse.mock.calls[0][0]).not.toHaveProperty("betas");
  });

  test.each([
    ["an unverified number", parsedMessage([...GOOD_ID.slice(0, 3), "Nilai transaksi Rp4,4 T."]), "UNVERIFIED_NUMBERS"],
    ["advice wording", parsedMessage([...GOOD_ID.slice(0, 3), "Saham ini layak dibeli."]), "ADVICE_WORDING"],
    ["a refusal", parsedMessage(null, "refusal"), "REFUSED"],
    ["a truncated answer", parsedMessage(null, "max_tokens"), "TRUNCATED"],
    ["no parsed output", parsedMessage(null), "MALFORMED"],
  ])("rejects %s without charging, and does not retry it immediately", async (_name, message, reason) => {
    const { client, parse } = mockClient({ parse: async () => message });
    setAnthropicClientForTests(client);
    const result = await getBriefNarrative(testBrief(), "id", context());
    expect(result).toMatchObject({ outcome: { status: "rejected", reason }, charged: false, quota: { used: 0 } });
    await getBriefNarrative(testBrief(), "id", context());
    expect(parse).toHaveBeenCalledTimes(1);
  });

  test("output that fails schema parsing is a rejection, not an error", async () => {
    const { client } = mockClient({ parse: async () => { throw new SyntaxError("Unexpected token"); } });
    setAnthropicClientForTests(client);
    expect((await getBriefNarrative(testBrief(), "id", context())).outcome).toEqual({ status: "rejected", reason: "MALFORMED" });
  });

  test("an API error is not cached and not charged", async () => {
    const { client, parse } = mockClient({ parse: async () => { throw new Anthropic.InternalServerError(500, undefined, "boom", new Headers()); } });
    setAnthropicClientForTests(client);
    await expect(getBriefNarrative(testBrief(), "id", context())).rejects.toEqual(new AiRequestError("AI_UPSTREAM_ERROR"));
    await expect(getBriefNarrative(testBrief(), "id", context())).rejects.toBeInstanceOf(AiRequestError);
    expect(parse).toHaveBeenCalledTimes(2);
    const { client: good } = mockClient({ parse: async () => parsedMessage(GOOD_ID) });
    setAnthropicClientForTests(good);
    expect(await getBriefNarrative(testBrief(), "id", context())).toMatchObject({ charged: true, quota: { used: 1 } });
  });

  test("the daily limit stops new generations but not cached ones", async () => {
    const { client } = mockClient({ parse: async () => parsedMessage(GOOD_ID) });
    setAnthropicClientForTests(client);
    for (const code of ["AAAA", "BBBB", "CCCC"]) await getBriefNarrative(testBrief({ code }), "id", context());
    await expect(getBriefNarrative(testBrief({ code: "DDDD" }), "id", context())).rejects.toBeInstanceOf(AiQuotaExceededError);
    expect(await getBriefNarrative(testBrief({ code: "AAAA" }), "id", context())).toMatchObject({ cached: true });
  });

  test("logs token usage but never the prompt or the output", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const { client } = mockClient({ parse: async () => parsedMessage(GOOD_ID) });
    setAnthropicClientForTests(client);
    await getBriefNarrative(testBrief(), "id", context());
    const logged = info.mock.calls.map((call) => String(call[0])).join("\n");
    expect(logged).toContain("\"inputTokens\":1200");
    expect(logged).not.toContain("9.875");
    expect(logged).not.toContain("Bank Central Asia");
    expect(logged).not.toContain(TEST_CONFIG.apiKey);
  });
});
