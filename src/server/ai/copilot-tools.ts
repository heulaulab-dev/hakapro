import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { WithFreshness } from "@/lib/freshness";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";
import { MarketDataError } from "@/server/market/errors";
import type { MarketDataSource } from "@/server/market/source";
import { symbolSchema } from "@/server/schemas/inputs";
import { getResearchBrief } from "@/server/services/research-brief";
import { narrativeFacts, type NarrativeLang } from "./narrative";

/**
 * Read-only copilot tools over existing MarketDataSource capabilities. Each returns `{ asOf, freshness, source, data }`
 * so the model can cite the as-of date; the numbers in `data` are computed here, never by the model.
 * Definitions are a fixed, ordered list so the tools prefix caches across users.
 */

const code = { type: "string", description: "IDX stock code: four capital letters, e.g. BBCA." } as const;
const object = (properties: Record<string, unknown>, required: string[]) => ({ type: "object" as const, properties, required, additionalProperties: false });

export const COPILOT_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_price",
    description: "Last price of one IDX stock for the current or latest session (last trade today, or the last close when it has not traded today), with today's running value, lots and frequency. Not a realtime tick.",
    input_schema: object({ code }, ["code"]),
  },
  {
    name: "get_price_history",
    description: "Summary of the last N daily sessions of one stock: first and last close, percent change, high, low, average volume, net foreign shares over the period, and the last five sessions.",
    input_schema: object({ code, sessions: { type: "integer", description: "Number of daily sessions, 5 to 60.", enum: [5, 10, 20, 30, 60] } }, ["code", "sessions"]),
  },
  {
    name: "get_broker_summary",
    description: "Broker summary of one stock for the latest session the provider has: top net-buying and net-selling brokers by value, optionally only foreign or only domestic investors.",
    input_schema: object({ code, flow: { type: "string", enum: ["all", "foreign", "domestic"], description: "Which investors to include." } }, ["code", "flow"]),
  },
  {
    name: "get_insider_transactions",
    description: "Most recent insider (director, commissioner, major shareholder) transactions reported for one stock: date, person, role, action and change in shares.",
    input_schema: object({ code }, ["code"]),
  },
  {
    name: "get_sector_performance",
    description: "Performance of every IDX sector in the newest session: percent change, advancers, decliners, traded value, and the leading and lagging stock.",
    input_schema: object({}, []),
  },
  {
    name: "get_research_brief",
    description: "HAKAPRO's Research Brief for one stock: price, momentum, foreign flow, broker flow, volume versus its 20-session baseline, insider transactions and KSEI ownership, each with its status and as-of date, plus counter-evidence. Prefer this for broad questions about one stock.",
    input_schema: object({ code }, ["code"]),
  },
].map((tool) => ({ ...tool, strict: true }));

const inputs = {
  get_price: z.object({ code: symbolSchema }),
  get_price_history: z.object({ code: symbolSchema, sessions: z.union([z.literal(5), z.literal(10), z.literal(20), z.literal(30), z.literal(60)]) }),
  get_broker_summary: z.object({ code: symbolSchema, flow: z.enum(["all", "foreign", "domestic"]) }),
  get_insider_transactions: z.object({ code: symbolSchema }),
  get_sector_performance: z.object({}),
  get_research_brief: z.object({ code: symbolSchema }),
} as const;
export type CopilotToolName = keyof typeof inputs;

export type ToolOutput = { asOf: string | null; freshness: string; source: string; data: unknown };
export type ToolResult = { ok: true; code: string | null; output: ToolOutput } | { ok: false; code: string | null; error: string };

const round2 = (value: number) => Math.round(value * 100) / 100;
const out = (envelope: WithFreshness<unknown>, data: unknown): ToolOutput => ({ asOf: envelope.asOf, freshness: envelope.freshness, source: envelope.source, data });

export async function runCopilotTool(name: string, rawInput: unknown, deps: { source: MarketDataSource; lang: NarrativeLang; signal?: AbortSignal }): Promise<ToolResult> {
  if (!(name in inputs)) return { ok: false, code: null, error: "UNKNOWN_TOOL" };
  const parsed = inputs[name as CopilotToolName].safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: null, error: "INVALID_INPUT" };
  const input = parsed.data as { code?: string; sessions?: number; flow?: "all" | "foreign" | "domestic" };
  const code = input.code ?? null;
  const { source, signal } = deps;
  try {
    switch (name as CopilotToolName) {
      case "get_price": {
        const envelope = await source.price(code!, signal);
        const { symbol, lastPriceIdr, sessionDate, tradedToday, lastTradeTime, valueIdr, lots, frequency } = envelope.data;
        return { ok: true, code, output: out(envelope, { symbol, lastPriceIdr, sessionDate, tradedToday, lastTradeTimeWib: lastTradeTime, valueIdr, lots, frequency }) };
      }
      case "get_price_history": {
        const envelope = await source.history(code!, { frame: "daily", limit: input.sessions! + 1 }, signal);
        const rows = envelope.data.rows.slice(-input.sessions!);
        if (!rows.length) return { ok: false, code, error: "NO_DATA" };
        const first = rows[0], last = rows.at(-1)!;
        return {
          ok: true, code, output: out(envelope, {
            symbol: envelope.data.symbol, sessions: rows.length, from: first.date, to: last.date,
            firstCloseIdr: first.close, lastCloseIdr: last.close, changePercent: first.close > 0 ? round2(((last.close - first.close) / first.close) * 100) : null,
            highIdr: Math.max(...rows.map((row) => row.high)), lowIdr: Math.min(...rows.map((row) => row.low)),
            averageVolumeShares: Math.round(rows.reduce((sum, row) => sum + row.volumeShares, 0) / rows.length),
            foreignNetShares: rows.reduce((sum, row) => sum + row.foreignNetShares, 0),
            lastSessions: rows.slice(-5).map(({ date, close, changePercent, volumeShares, foreignNetShares }) => ({ date, closeIdr: close, changePercent, volumeShares, foreignNetShares })),
          }),
        };
      }
      case "get_broker_summary": {
        const envelope = await source.brokerSummary(code!, { flow: input.flow, brokerLimit: ARJUM_LIMITS.brokerSummaryRows, levelLimit: 1 }, signal);
        const brokers = [...envelope.data.brokers].sort((a, b) => b.netValueIdr - a.netValueIdr);
        const pick = (rows: typeof brokers) => rows.map(({ code: broker, name: brokerName, netValueIdr, netVolumeShares }) => ({ broker, brokerName, netValueIdr, netVolumeShares }));
        return {
          ok: true, code, output: out(envelope, {
            symbol: envelope.data.symbol, startDate: envelope.data.startDate, endDate: envelope.data.endDate, flow: envelope.data.flow,
            topNetBuyers: pick(brokers.filter((row) => row.netValueIdr > 0).slice(0, 5)),
            topNetSellers: pick(brokers.filter((row) => row.netValueIdr < 0).reverse().slice(0, 5)),
          }),
        };
      }
      case "get_insider_transactions": {
        const envelope = await source.insiders(code!, { limit: 10 }, signal);
        return {
          ok: true, code, output: out(envelope, {
            symbol: envelope.data.symbol, totalReported: envelope.data.total,
            transactions: envelope.data.rows.map(({ date, person, roles, action, changeShares, currentPercent, priceIdr }) => ({ date, person, roles, action, changeShares, currentPercent, priceIdr })),
          }),
        };
      }
      case "get_sector_performance": {
        const envelope = await source.sectors();
        return { ok: true, code, output: out(envelope, envelope.data) };
      }
      case "get_research_brief": {
        const brief = await getResearchBrief(source, code!);
        return { ok: true, code, output: { asOf: brief.asOf, freshness: brief.freshness, source: "hakapro/research-brief", data: narrativeFacts(brief, deps.lang) } };
      }
    }
  } catch (error) {
    return { ok: false, code, error: error instanceof MarketDataError ? error.code : error instanceof Error && error.name === "UnknownTickerError" ? "NOT_FOUND" : error instanceof Error && error.name === "BriefUnavailableError" ? "DATA_UNAVAILABLE" : "INTERNAL_ERROR" };
  }
  return { ok: false, code, error: "UNKNOWN_TOOL" };
}
