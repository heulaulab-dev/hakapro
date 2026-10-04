// Shared by scripts/record-fixtures.ts (Bun, no `server-only`) and fixture-source.ts.
// Pure: no fs, no network, no env access.
import { z } from "zod";
import {
  analysisResponseSchema, priceResponseSchema, brokerAccumulationResponseSchema, brokerSummaryResponseSchema, doneDetailsResponseSchema, financialStatementsResponseSchema,
  healthResponseSchema, historyResponseSchema, insidersResponseSchema, marketCapResponseSchema, screenerResponseSchema,
  searchResponseSchema, seasonalityResponseSchema,
} from "@/server/schemas/arjum";

export const GLOBAL_ENDPOINTS = { screener: screenerResponseSchema, "market-cap": marketCapResponseSchema, health: healthResponseSchema } as const;
export const SYMBOL_ENDPOINTS = {
  "broker-summary": brokerSummaryResponseSchema,
  "broker-accumulation": brokerAccumulationResponseSchema,
  history: historyResponseSchema,
  seasonal: seasonalityResponseSchema,
  "financial-statements": financialStatementsResponseSchema,
  insiders: insidersResponseSchema,
  "done-details": doneDetailsResponseSchema,
  price: priceResponseSchema,
  analysis: analysisResponseSchema,
} as const;
/** Provider report_type values (arjum calls cash flow "CASH_FLOW_REPORT"). */
export const REPORT_TYPES = ["INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW_REPORT"] as const;

export type GlobalEndpoint = keyof typeof GLOBAL_ENDPOINTS;
export type SymbolEndpoint = keyof typeof SYMBOL_ENDPOINTS;
export type FixtureEndpoint = GlobalEndpoint | SymbolEndpoint | "search";

export function schemaFor(endpoint: FixtureEndpoint): z.ZodType {
  if (endpoint === "search") return searchResponseSchema;
  return (GLOBAL_ENDPOINTS as Record<string, z.ZodType>)[endpoint] ?? (SYMBOL_ENDPOINTS as Record<string, z.ZodType>)[endpoint];
}

/** Relative path of a recorded file inside a fixture dataset directory. */
export function fixturePath(endpoint: FixtureEndpoint, options: { symbol?: string; reportType?: string; searchKey?: string } = {}): string {
  if (endpoint in GLOBAL_ENDPOINTS) return `global/${endpoint}.json`;
  if (endpoint === "search") return `search/${options.searchKey ?? options.symbol}.json`;
  if (!options.symbol) throw new Error(`${endpoint} needs a symbol`);
  const suffix = endpoint === "financial-statements" ? `.${options.reportType ?? "INCOME_STATEMENT"}` : "";
  return `symbols/${options.symbol}/${endpoint}${suffix}.json`;
}

export const manifestSchema = z.object({
  provider: z.literal("arjum"),
  recordedAt: z.string(),
  note: z.string().optional(),
  screenerDate: z.string().nullable(),
  symbols: z.array(z.string()),
  files: z.array(z.object({
    path: z.string(),
    endpoint: z.string(),
    symbol: z.string().optional(),
    params: z.record(z.string(), z.union([z.string(), z.number()])),
  })),
  failures: z.array(z.object({ endpoint: z.string(), symbol: z.string().optional(), status: z.union([z.number(), z.string()]) })).default([]),
});
export type FixtureManifest = z.infer<typeof manifestSchema>;

const SENSITIVE_KEY = /(api[_-]?key|token|secret|auth|password|cookie|session|email|user[_-]?id)/i;
const ORDER_NUMBER_KEYS = new Set(["buy_order_number", "sell_order_number"]);

/**
 * Removes anything that must not be committed from a provider response body:
 *  - object keys that look like credentials or user identifiers are dropped;
 *  - any string containing a secret (API key value, provider host) has it replaced by "[REDACTED]";
 *  - exchange order numbers in done-details are replaced by "REDACTED" (kept as strings so schemas parse).
 * Public disclosure data (insider names, broker codes) is kept.
 */
export function sanitizeRecording(value: unknown, secrets: readonly string[]): unknown {
  const needles = secrets.map((secret) => secret.trim()).filter((secret) => secret.length >= 4);
  const scrub = (text: string) => needles.reduce((acc, needle) => acc.split(needle).join("[REDACTED]"), text);
  const visit = (node: unknown): unknown => {
    if (typeof node === "string") return scrub(node);
    if (Array.isArray(node)) return node.map(visit);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(node)) {
        if (SENSITIVE_KEY.test(key)) continue;
        out[key] = ORDER_NUMBER_KEYS.has(key) && typeof child === "string" ? "REDACTED" : visit(child);
      }
      return out;
    }
    return node;
  };
  return visit(value);
}

/** Host part of a base URL, used as a secret needle (the provider host must not leak into fixtures). */
export function hostOf(baseUrl: string): string | null {
  try { return new URL(baseUrl).host || null; } catch { return null; }
}
