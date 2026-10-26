import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { wib } from "../../../tests/support/fixtures";
import { withFreshness } from "@/lib/freshness";
import { unsupported } from "@/server/market/errors";
import type { MarketDataSource } from "@/server/market/source";
import { ADVICE_REFUSAL } from "./advice-guard";
import { setAnthropicClientForTests } from "./client";
import { startCopilot, type CopilotEvent } from "./copilot";
import { COPILOT_TOOLS, runCopilotTool } from "./copilot-tools";
import { AiQuotaExceededError } from "./errors";
import { aiQuotaStatus, clearAiQuota } from "./quota";
import { mockClient, streamedTurn, TEST_CONFIG } from "./test-support";

const NOW = wib("2026-10-21T17:00:00");

/** Only `price` and `sectors` answer; everything else is UNSUPPORTED. */
const source = new Proxy({ id: "stub" } as MarketDataSource, {
  get(_target, property) {
    if (property === "id") return "stub";
    if (property === "price") return async (symbol: string) => withFreshness({ symbol, lastPriceIdr: 9875, frequency: 1200, lots: 35_000, valueIdr: 34_562_500_000, sessionDate: "2026-10-21", tradedToday: true, lastTradeTime: "15:49:58", servedTime: "17:00:00", marketState: "closed", quoteAgeMs: null }, { freshness: "EOD", asOf: "2026-10-21T15:49:58+07:00", source: "stub" });
    if (property === "sectors") return async () => withFreshness([{ sector: "Financials", stocks: 100, advancers: 40, decliners: 50, unchanged: 10, changePercent: -0.42, valueWeightedChangePercent: null, valueIdr: 5e12, leader: { symbol: "BBCA", changePercent: 1.2 }, laggard: { symbol: "BBRI", changePercent: -2.1 } }], { freshness: "EOD", asOf: "2026-10-21", source: "stub" });
    return async () => { throw unsupported("stub", String(property)); };
  },
});

const deps = () => ({ config: TEST_CONFIG, userKey: "user:1", source, now: () => NOW });
const ask = (content: string, lang: "id" | "en" = "id") => ({ turns: [{ role: "user" as const, content }], lang });
async function collect(events: AsyncGenerator<CopilotEvent>): Promise<CopilotEvent[]> {
  const all: CopilotEvent[] = [];
  for await (const event of events) all.push(event);
  return all;
}

beforeEach(() => {
  clearAiQuota();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  setAnthropicClientForTests(null);
  vi.restoreAllMocks();
});

describe("copilot tools", () => {
  test("six read-only tools with strict schemas", () => {
    expect(COPILOT_TOOLS.map((tool) => tool.name)).toEqual(["get_price", "get_price_history", "get_broker_summary", "get_insider_transactions", "get_sector_performance", "get_research_brief"]);
    for (const tool of COPILOT_TOOLS) expect(tool).toMatchObject({ strict: true, input_schema: { type: "object", additionalProperties: false } });
  });
  test("validates input and reports provider errors as codes", async () => {
    expect(await runCopilotTool("get_price", { code: "bbca; drop" }, { source, lang: "id" })).toEqual({ ok: false, code: null, error: "INVALID_INPUT" });
    expect(await runCopilotTool("delete_everything", {}, { source, lang: "id" })).toEqual({ ok: false, code: null, error: "UNKNOWN_TOOL" });
    expect(await runCopilotTool("get_insider_transactions", { code: "BBCA" }, { source, lang: "id" })).toEqual({ ok: false, code: "BBCA", error: "UNSUPPORTED" });
    expect(await runCopilotTool("get_price", { code: "BBCA" }, { source, lang: "id" })).toMatchObject({ ok: true, output: { asOf: "2026-10-21T15:49:58+07:00", data: { lastPriceIdr: 9875 } } });
  });
});

describe("startCopilot", () => {
  test("refuses advice requests politely without a model call or a charge", async () => {
    const { client, stream } = mockClient();
    setAnthropicClientForTests(client);
    const events = await collect(startCopilot(ask("Harus beli BBCA sekarang?"), deps()));
    expect(events).toEqual([{ type: "text", text: ADVICE_REFUSAL.id }, { type: "done", citations: [], charged: false, refusal: true }]);
    expect(stream).not.toHaveBeenCalled();
    expect(aiQuotaStatus("user:1", 3, NOW).used).toBe(0);
  });

  test("runs the tool loop, streams the answer and cites tool and as-of", async () => {
    const { client, stream } = mockClient({ stream: [
      streamedTurn([{ type: "tool_use", id: "t1", name: "get_price", input: { code: "BBCA" } }]),
      streamedTurn([{ type: "text", text: "Harga terakhir BBCA Rp9.875 " }, { type: "text", text: "per 21 Oktober 2026 pukul 15:49 WIB." }]),
    ] });
    setAnthropicClientForTests(client);
    const events = await collect(startCopilot(ask("Berapa harga BBCA?"), deps()));
    expect(events).toEqual([
      { type: "tool", tool: "get_price", code: "BBCA" },
      { type: "text", text: "Harga terakhir BBCA Rp9.875 " },
      { type: "text", text: "per 21 Oktober 2026 pukul 15:49 WIB." },
      { type: "done", citations: [{ tool: "get_price", code: "BBCA", asOf: "2026-10-21T15:49:58+07:00", source: "stub" }], charged: true, refusal: false },
    ]);
    expect(aiQuotaStatus("user:1", 3, NOW).used).toBe(1);
    const first = stream.mock.calls[0] as unknown as [Record<string, unknown> & { messages: Array<{ content: Array<{ text: string }> }> }];
    expect(first[0]).toMatchObject({
      model: "claude-opus-5-5", tool_choice: { type: "auto" }, cache_control: { type: "ephemeral" }, fallbacks: "default",
      system: [expect.objectContaining({ cache_control: { type: "ephemeral" } })], output_config: { effort: "medium" },
    });
    expect(first[0].messages[0].content[0].text).toBe("Language: id (Bahasa Indonesia). Today in Jakarta: 2026-10-21.");
    // The tool result goes back as one user message with the tool_use id.
    const second = stream.mock.calls[1] as unknown as [{ messages: Array<{ role: string; content: unknown }> }];
    expect(second[0].messages.at(-1)).toMatchObject({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1" }] });
  });

  test("retracts an answer with a number no tool returned, and does not charge", async () => {
    const { client } = mockClient({ stream: [
      streamedTurn([{ type: "tool_use", id: "t1", name: "get_price", input: { code: "BBCA" } }]),
      streamedTurn([{ type: "text", text: "Harga BBCA Rp9.875, naik 2,5% minggu ini." }]),
    ] });
    setAnthropicClientForTests(client);
    const events = await collect(startCopilot(ask("Berapa harga BBCA?"), deps()));
    expect(events.at(-1)).toEqual({ type: "retract", reason: "UNVERIFIED_NUMBERS" });
    expect(aiQuotaStatus("user:1", 3, NOW).used).toBe(0);
  });

  test("an answer with numbers but no tool call is retracted", async () => {
    const { client } = mockClient({ stream: [streamedTurn([{ type: "text", text: "BBCA biasanya di kisaran Rp9.000." }])] });
    setAnthropicClientForTests(client);
    expect((await collect(startCopilot(ask("BBCA itu apa?"), deps()))).at(-1)).toEqual({ type: "retract", reason: "UNVERIFIED_NUMBERS" });
  });

  test("caps the tool loop: the last allowed turn may not call tools", async () => {
    const tool = (id: string) => streamedTurn([{ type: "tool_use", id, name: "get_sector_performance", input: {} }]);
    const { client, stream } = mockClient({ stream: [tool("t1"), tool("t2"), streamedTurn([{ type: "text", text: "Sektor Financials turun 0,42% per 21 Okt 2026." }])] });
    setAnthropicClientForTests(client);
    const events = await collect(startCopilot(ask("Sektor mana yang turun?"), deps()));
    expect(stream).toHaveBeenCalledTimes(TEST_CONFIG.copilotMaxIterations);
    expect((stream.mock.calls[2] as unknown as [{ tool_choice: unknown }])[0].tool_choice).toEqual({ type: "none" });
    expect(events.at(-1)).toMatchObject({ type: "done", charged: true, citations: [{ tool: "get_sector_performance", code: null }] });
  });

  test("a refusal stop reason retracts without charge", async () => {
    const { client } = mockClient({ stream: [streamedTurn([{ type: "text", text: "..." }], "refusal")] });
    setAnthropicClientForTests(client);
    expect((await collect(startCopilot(ask("Apa itu IHSG?"), deps()))).at(-1)).toEqual({ type: "retract", reason: "REFUSED" });
    expect(aiQuotaStatus("user:1", 3, NOW).used).toBe(0);
  });

  test("an API failure becomes an error event and releases the slot", async () => {
    const { client } = mockClient({ stream: [] });
    setAnthropicClientForTests(client);
    expect((await collect(startCopilot(ask("Apa itu IHSG?"), deps()))).at(-1)).toEqual({ type: "error", code: "INTERNAL_ERROR" });
    expect(aiQuotaStatus("user:1", 3, NOW)).toMatchObject({ used: 0, remaining: 3 });
  });

  test("throws before streaming when the daily limit is used up", async () => {
    const turns = () => [streamedTurn([{ type: "text", text: "IHSG adalah indeks harga saham gabungan." }])];
    for (let index = 0; index < TEST_CONFIG.dailyLimit; index += 1) {
      setAnthropicClientForTests(mockClient({ stream: turns() }).client);
      await collect(startCopilot(ask("Apa itu IHSG?"), deps()));
    }
    expect(() => startCopilot(ask("Apa itu IHSG?"), deps())).toThrow(AiQuotaExceededError);
  });
});
