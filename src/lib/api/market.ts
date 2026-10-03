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

// --- Stock overview (/api/overview/[code]) -------------------------------------------------
const freshnessFields = { freshness: z.enum(["LIVE", "DELAYED", "EOD", "HISTORICAL", "STALE", "UNAVAILABLE"]), asOf: z.string().nullable(), period: z.string().optional(), source: z.string() };
const section = <T extends z.ZodType>(data: T) =>
  z.discriminatedUnion("status", [z.object({ status: z.literal("ok"), data, ...freshnessFields }), z.object({ status: z.literal("error"), error: z.string() })]);
const brokerNet = z.object({ code: z.string(), netValueIdr: n });
export const stockOverviewSchema = z.object({
  symbol: z.string(),
  price: section(z.object({ date: z.string(), close: n, change: n, changePercent: n, rangeSessions: n, rangeChangePercent: nn, rangeHigh: n, rangeLow: n, sma20: nn, closeVsSma20: z.enum(["above", "below", "at"]).nullable() })),
  foreignFlow: section(z.object({ sessions: n, netBuySessions: n, netSellSessions: n, netShares: n, netShares20: nn, latestDate: z.string() })),
  brokers: section(z.object({ startDate: z.string(), endDate: z.string(), topBuyers: z.array(brokerNet), topSellers: z.array(brokerNet) })),
  ownership: section(z.object({ transactions: n, buys: n, sells: n, netChangeShares: nn, latestDate: z.string().nullable(), totalReported: n })),
  financials: section(z.object({ reportType: z.string(), latestPeriod: z.string().nullable(), latestPeriodEnd: z.string().nullable(), expectedPeriodEnd: z.string(), behind: z.boolean(), periods: n })),
});
export type StockOverview = z.infer<typeof stockOverviewSchema>;
export type OverviewSection = StockOverview[keyof Omit<StockOverview, "symbol">];

// --- idx-bei lane (market overview, news) ---------------------------------------------------
export const marketOverviewSchema = z.object({
  indices: z.array(z.object({ code: z.string().nullable(), name: z.string().nullable(), close: nn, previousClose: nn, changePercent: nn })),
  breadth: z.object({ advancers: n, decliners: n, unchanged: n, valueIdr: n, volumeShares: n, frequency: n }),
  movers: z.array(z.object({ symbol: z.string().nullable(), name: z.string().nullable(), close: nn, changePercent: nn, volumeShares: nn, valueIdr: nn, frequency: nn })),
});
export const newsItemSchema = z.object({ date: z.string().nullable(), title: z.string().nullable(), summary: z.string().nullable(), url: z.string().nullable() });

export const overviewApi = {
  stock: (symbol: string, signal?: AbortSignal) => fetchEnvelope(`/api/overview/${encodeURIComponent(symbol.toUpperCase())}`, stockOverviewSchema, { signal }),
  market: (signal?: AbortSignal) => fetchEnvelope("/api/market", marketOverviewSchema, { signal }),
  news: (signal?: AbortSignal) => fetchEnvelope("/api/news?per_page=8", z.array(newsItemSchema), { signal }),
};

// --- Quotes (/api/quotes) ------------------------------------------------------------------
export const quoteSchema = z.discriminatedUnion("status", [
  z.object({ symbol: z.string(), status: z.literal("ok"), date: z.string(), close: n, change: n, changePercent: n, ...freshnessFields }),
  z.object({ symbol: z.string(), status: z.literal("error"), error: z.string() }),
]);
export type QuoteItem = z.infer<typeof quoteSchema>;
export const quotesApi = {
  get: (symbols: string[], signal?: AbortSignal) => fetchEnvelope(`/api/quotes?symbols=${symbols.map(encodeURIComponent).join(",")}`, z.array(quoteSchema), { signal }),
};

// --- Broker accumulation (/api/broker-accumulation/[code]) ------------------------------------
const accumulationPoint = z.object({ date: z.string(), netValueIdr: n, netVolumeShares: n, cumulativeNetValueIdr: n, buyAverageIdr: nn, sellAverageIdr: nn });
const brokerTotal = z.object({ code: z.string(), name: z.string(), totalNetValueIdr: n });
export const brokerAccumulationSchema = z.object({
  symbol: z.string(), startDate: z.string(), endDate: z.string(),
  series: z.array(z.object({ code: z.string(), name: z.string(), points: z.array(accumulationPoint) })),
  topBuyers: z.array(brokerTotal), topSellers: z.array(brokerTotal),
});
export type BrokerAccumulation = z.infer<typeof brokerAccumulationSchema>;
export const accumulationApi = {
  get: (symbol: string, query: { startDate?: string; endDate?: string; top?: number }, signal?: AbortSignal) => {
    const params = new URLSearchParams();
    if (query.startDate) params.set("start_date", query.startDate);
    if (query.endDate) params.set("end_date", query.endDate);
    if (query.top) params.set("top", String(query.top));
    return fetchEnvelope(`/api/broker-accumulation/${encodeURIComponent(symbol.toUpperCase())}${params.size ? `?${params}` : ""}`, brokerAccumulationSchema, { signal });
  },
};

// --- Financial statements (/api/financial-statements/[code]) ----------------------------------
export const financialStatementsSchema = z.object({
  symbol: z.string(), reportType: z.string(), period: z.string(),
  periods: z.array(z.object({ year: z.string(), quarter: z.string(), label: z.string(), periodEnd: z.string().nullable(), filingDate: z.string().nullable(), fetchedAt: z.string() })),
  rows: z.array(z.object({ key: z.string(), label: z.string(), depth: n, expandable: z.boolean(), values: z.array(nn) })),
  reportingLag: z.object({ latestPeriodEnd: z.string().nullable(), expectedPeriodEnd: z.string(), behind: z.boolean() }),
});
export type FinancialStatements = z.infer<typeof financialStatementsSchema>;
export const REPORT_TYPES = ["INCOME_STATEMENT", "BALANCE_SHEET", "CASH_FLOW"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const financialsApi = {
  get: (symbol: string, reportType: ReportType, period: "quarterly" | "annual", signal?: AbortSignal) =>
    fetchEnvelope(`/api/financial-statements/${encodeURIComponent(symbol.toUpperCase())}?report_type=${reportType}&period=${period}&limit=12`, financialStatementsSchema, { signal }),
};

// --- Screener (POST /api/screener, idx-bei lane) ---------------------------------------------
export const SCREEN_FIELDS = ["price", "volume", "value", "frequency", "foreignNetShares", "marketCap", "per", "pbv", "roe", "roa", "eps", "der", "dividendYield", "change1D"] as const;
export type ScreenField = (typeof SCREEN_FIELDS)[number];
export const SCREEN_OPERATORS = ["GT", "GTE", "LT", "LTE", "EQ"] as const;
export const screenConditionSchema = z.object({
  field: z.enum(SCREEN_FIELDS),
  operator: z.enum(SCREEN_OPERATORS),
  value: z.number(),
  connective: z.enum(["AND", "OR"]).default("AND"),
});
export type ScreenCondition = z.infer<typeof screenConditionSchema>;
export const screenResultSchema = z.object({
  rows: z.array(z.object({ symbol: z.string(), name: z.string().nullable() }).catchall(z.number().nullable())),
  total: n,
  supportedFields: z.array(z.string()),
});
export type ScreenResult = z.infer<typeof screenResultSchema>;
export const screenerApi = {
  run: (conditions: ScreenCondition[], signal?: AbortSignal) =>
    fetchEnvelope("/api/screener", screenResultSchema, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ conditions, limit: 500 }), signal }),
};
