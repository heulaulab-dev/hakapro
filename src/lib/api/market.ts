/**
 * Client-side contracts for the BFF. They mirror the server domain types
 * (src/server/market/types.ts); every response is validated again here.
 */
import { z } from "zod";
import { fetchEnvelope } from "./envelope";

const n = z.number();
const nn = z.number().nullable();

export const searchResultSchema = z.object({ symbol: z.string(), companyName: z.string(), lastDate: z.string() });
export type SearchResult = z.infer<typeof searchResultSchema>;

export const historyRowSchema = z.object({
  date: z.string(), open: n, high: n, low: n, close: n, averageIdr: n, change: n, changePercent: n,
  valueIdr: n, volumeShares: n, frequency: n, foreignBuyShares: n, foreignSellShares: n, foreignNetShares: n,
});
export const historySchema = z.object({ symbol: z.string(), frame: z.string(), rows: z.array(historyRowSchema) });
export type HistoryRow = z.infer<typeof historyRowSchema>;
export type History = z.infer<typeof historySchema>;

export const brokerRowSchema = z.object({
  code: z.string(), name: z.string(), buyValueIdr: n, sellValueIdr: n, netValueIdr: n,
  buyVolumeShares: n, sellVolumeShares: n, netVolumeShares: n, buyFrequency: n, sellFrequency: n, netFrequency: n,
});
export const brokerSummarySchema = z.object({ symbol: z.string(), startDate: z.string(), endDate: z.string(), brokers: z.array(brokerRowSchema) });
export type BrokerRow = z.infer<typeof brokerRowSchema>;

export const criterionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("recognized"), key: z.string(), flag: z.string() }),
  z.object({ kind: z.literal("unrecognized"), flag: z.string(), providerLabel: z.string().nullable() }),
]);
export const strategyMatchSchema = z.object({ symbol: z.string(), name: z.string(), criteria: z.array(criterionSchema), providerNote: z.string().nullable() });
export const strategySchema = z.object({ id: z.string(), name: z.string(), description: z.string().nullable(), matches: z.array(strategyMatchSchema) });
export const strategyScreenSchema = z.object({
  date: z.string().nullable(),
  screenerVersion: z.string().nullable(),
  marketCondition: z.object({ label: z.string(), averageChangePercent: nn }).nullable(),
  universe: z.object({ covered: n, liquid: n, skipped: n }).nullable(),
  strategies: z.array(strategySchema),
});
export type Criterion = z.infer<typeof criterionSchema>;
export type StrategyMatch = z.infer<typeof strategyMatchSchema>;
export type Strategy = z.infer<typeof strategySchema>;
export type StrategyScreen = z.infer<typeof strategyScreenSchema>;

export const insiderRowSchema = z.object({
  person: z.string(), date: z.string(), action: z.enum(["BUY", "SELL", "CROSS", "OTHER"]), nationality: z.string(), roles: z.array(z.string()), broker: z.string().nullable(),
  previousShares: nn, currentShares: nn, changeShares: nn, previousPercent: nn, currentPercent: nn, changePercent: nn, priceIdr: nn,
});
export const insidersSchema = z.object({ symbol: z.string(), total: n, page: n, pageSize: n, totalPages: n, rows: z.array(insiderRowSchema) });
export type InsiderRow = z.infer<typeof insiderRowSchema>;

export const marketCapRowSchema = z.object({ symbol: z.string(), name: z.string(), closeIdr: n, marketCapIdr: n, listedShares: n, turnoverRatio: n });
export const marketCapSchema = z.object({ date: z.string(), total: n, page: n, perPage: n, totalPages: n, rows: z.array(marketCapRowSchema) });
export type MarketCapRow = z.infer<typeof marketCapRowSchema>;

const sym = (symbol: string) => encodeURIComponent(symbol.toUpperCase());

export const marketApi = {
  search: (q: string, signal?: AbortSignal) => fetchEnvelope(`/api/search?q=${encodeURIComponent(q)}`, z.array(searchResultSchema), { signal }),
  history: (symbol: string, query: { frame?: string; limit?: number } = {}, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (query.frame) params.set("frame", query.frame);
    if (query.limit) params.set("limit", String(query.limit));
    return fetchEnvelope(`/api/history/${sym(symbol)}${params.size ? `?${params}` : ""}`, historySchema, { signal });
  },
  brokerSummary: (symbol: string, signal?: AbortSignal) => fetchEnvelope(`/api/broker-summary/${sym(symbol)}`, brokerSummarySchema, { signal }),
  strategies: (signal?: AbortSignal) => fetchEnvelope("/api/strategies", strategyScreenSchema, { signal }),
  insiders: (symbol: string, signal?: AbortSignal) => fetchEnvelope(`/api/insiders/${sym(symbol)}`, insidersSchema, { signal }),
  marketCap: (signal?: AbortSignal) => fetchEnvelope("/api/market-cap", marketCapSchema, { signal }),
};
