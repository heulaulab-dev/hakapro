/**
 * Test helpers: a mocked Anthropic client (no network, no key) and a small Research Brief. Imported only by tests.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";
import type { AiConfig } from "@/server/config/ai";
import type { ResearchBrief } from "@/server/services/research-brief";

export const TEST_CONFIG: AiConfig = {
  apiKey: "sk-test-not-a-real-key", models: { narrative: "claude-opus-5-5", copilot: "claude-opus-5-5" },
  dailyLimit: 3, timeoutMs: 1000, maxRetries: 0, copilotMaxIterations: 3,
};

const usage = { input_tokens: 1200, output_tokens: 180, cache_read_input_tokens: 900, cache_creation_input_tokens: 0 };

export function parsedMessage(sentences: string[] | null, stopReason = "end_turn") {
  return { id: "msg_test", model: "claude-opus-5-5", role: "assistant", stop_reason: stopReason, content: [], usage, parsed_output: sentences ? { sentences } : null };
}

type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: unknown };

/** A finished streamed turn: text deltas for its text blocks, then `finalMessage()`. */
export function streamedTurn(blocks: Block[], stopReason?: string) {
  const message = { id: "msg_test", model: "claude-opus-5-5", role: "assistant", content: blocks, usage, stop_reason: stopReason ?? (blocks.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn") };
  return {
    async *[Symbol.asyncIterator]() {
      for (const block of blocks) if (block.type === "text") yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: block.text } };
    },
    finalMessage: async () => message,
  };
}

export function mockClient(options: { parse?: (...args: unknown[]) => unknown; stream?: Array<ReturnType<typeof streamedTurn>> } = {}) {
  const parse = vi.fn(options.parse ?? (async () => parsedMessage(null)));
  const turns = [...(options.stream ?? [])];
  const stream = vi.fn(() => {
    const next = turns.shift();
    if (!next) throw new Error("no more mocked turns");
    return next;
  });
  const client = { beta: { messages: { parse, stream } }, models: { retrieve: vi.fn(async (id: string) => ({ id })) } } as unknown as Anthropic;
  return { client, parse, stream };
}

export function testBrief(overrides: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    code: "BBCA", name: "Bank Central Asia Tbk.", sector: "Financials", asOf: "2026-10-21", freshness: "fresh",
    price: { last: 9875, change: -125, changePct: -1.25, window: "1D", session: "2026-10-21", source: { table: "arjum/price", asOf: "2026-10-21" }, meta: { freshness: "EOD", asOf: "2026-10-21", source: "arjum" } },
    score: { value: null, confidence: 0.67, version: "none" },
    windows: ["1D", "5D", "7D", "14D", "30D"],
    components: [
      { key: "momentum", weight: 0, raw: { session: "2026-10-21", close: 9875, sma20: 9712.4, closeVsSma20: "above", change1DPct: -1.25, change5DPct: 3.21 }, points: null, status: "ok", reason: null, source: { table: "arjum/history", asOf: "2026-10-21" } },
      { key: "foreign", weight: 0, raw: { session: "2026-10-21", net5D: -1_200_000, buySessions: 2, sellSessions: 3, flowSessions: 5 }, points: null, status: "ok", reason: null, source: { table: "arjum/history", asOf: "2026-10-21" } },
      { key: "broker", weight: 0, raw: {}, points: null, status: "missing", reason: "PROVIDER_UNAVAILABLE", source: { table: "broker_summary", asOf: null } },
      { key: "ksei", weight: 0, raw: {}, points: null, status: "missing", reason: "NOT_UPLOADED", source: { table: "engine/ksei_ownership", asOf: null } },
      { key: "insider", weight: 0, raw: { lookbackDays: 30, since: "2026-09-22", transactions: 1, buys: 0, sells: 1, netShares: -50_000, latestDate: "2026-10-14", totalReported: 1, truncated: 0 }, points: null, status: "ok", reason: null, source: { table: "arjum/insiders", asOf: "2026-10-14" } },
      { key: "volume", weight: 0, raw: { session: "2026-10-21", volumeShares: 57_300_000, avgVolumeShares: 31_100_000, volumeRatio: 1.84, baselineSessions: 20 }, points: null, status: "ok", reason: null, source: { table: "arjum/history", asOf: "2026-10-21" } },
    ],
    insiderTransactions: [{ date: "2026-10-14", person: "Budi Santoso", action: "SELL", roles: ["Direktur"], changeShares: -50_000, priceIdr: 9950 }],
    counterEvidence: [{ key: "foreign_5D", component: "foreign", window: "5D", text: {
      id: "Harga naik 3,21% dalam 5 sesi hingga 21 Okt 2026, sementara investor asing mencatat jual bersih 1,2 jt lembar pada periode yang sama.",
      en: "Price rose 3.21% over 5 sessions to Oct 21, 2026, while foreign investors were net sellers of 1.2M shares over the same window.",
    } }],
    checks: [{ key: "price_history", result: "match" }],
    sources: [{ table: "arjum/price", asOf: "2026-10-21", rows: 1, range: null }],
    quota: { used: 0, limit: null, charged: false },
    generatedAt: "2026-10-21T10:00:00.000Z",
    ...overrides,
  };
}
