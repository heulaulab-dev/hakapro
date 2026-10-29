/**
 * Client-side contracts for the BFF. They mirror the server domain types
 * (src/server/market/types.ts); every response is validated again here.
 */
import { z } from "zod";
import { RADAR_COUNTER_KEYS, RADAR_SIGNAL_KEYS } from "@/lib/radar/rules";
import { strategyBoardSchema } from "@/lib/strategies/contract";
import { fetchEnvelope } from "./envelope";

const n = z.number();
const nn = z.number().nullable();

export const searchResultSchema = z.object({ symbol: z.string(), companyName: z.string(), lastDate: z.string() });
export type SearchResult = z.infer<typeof searchResultSchema>;

export const historyRowSchema = z.object({
  date: z.string(), open: n, high: n, low: n, close: n, averageIdr: nn, change: n, changePercent: n,
  valueIdr: n, volumeShares: n, frequency: n, foreignBuyShares: n, foreignSellShares: n, foreignNetShares: n,
});
export const historySchema = z.object({ symbol: z.string(), frame: z.string(), rows: z.array(historyRowSchema), available: z.object({ from: z.string(), to: z.string() }).nullable() });
export type HistoryRow = z.infer<typeof historyRowSchema>;
export type History = z.infer<typeof historySchema>;

export const brokerRowSchema = z.object({
  code: z.string(), name: z.string(), buyValueIdr: n, sellValueIdr: n, netValueIdr: n,
  buyVolumeShares: n, sellVolumeShares: n, netVolumeShares: n, buyFrequency: n, sellFrequency: n, netFrequency: n,
});
const brokerLevelSide = z.object({ code: z.string(), name: z.string(), valueIdr: n, volumeShares: n, frequency: nn, averagePriceIdr: n });
export const BROKER_FLOWS = ["all", "foreign", "domestic"] as const;
export type BrokerFlow = (typeof BROKER_FLOWS)[number];
export const brokerSummarySchema = z.object({
  symbol: z.string(), startDate: z.string(), endDate: z.string(), availableFrom: z.string(), availableTo: z.string(),
  flow: z.enum(BROKER_FLOWS), net: z.boolean(),
  brokers: z.array(brokerRowSchema),
  levels: z.array(z.object({ rank: n, buy: brokerLevelSide.nullable(), sell: brokerLevelSide.nullable() })),
});
export type BrokerRow = z.infer<typeof brokerRowSchema>;
export type BrokerSummary = z.infer<typeof brokerSummarySchema>;
export type BrokerLevel = BrokerSummary["levels"][number];
export type BrokerSummaryQuery = { startDate?: string; endDate?: string; flow?: BrokerFlow; net?: boolean; brokerLimit?: number; levelLimit?: number };
export const brokerDirectorySchema = z.object({ brokers: z.array(z.object({ code: z.string(), name: z.string(), license: z.string().nullable() })) });
export type BrokerDirectory = z.infer<typeof brokerDirectorySchema>;


export const insiderRowSchema = z.object({
  person: z.string(), date: z.string(), action: z.enum(["BUY", "SELL", "CROSS", "OTHER"]), nationality: z.string(), roles: z.array(z.string()), broker: z.string().nullable(),
  previousShares: nn, currentShares: nn, changeShares: nn, previousPercent: nn, currentPercent: nn, changePercent: nn, priceIdr: nn,
});
export const insidersSchema = z.object({ symbol: z.string(), total: n, page: n, pageSize: n, totalPages: n, rows: z.array(insiderRowSchema) });
export type InsiderRow = z.infer<typeof insiderRowSchema>;

export const marketCapRowSchema = z.object({ symbol: z.string(), name: z.string(), closeIdr: n, marketCapIdr: n, listedShares: n, turnoverRatio: n });
export const marketCapSchema = z.object({ date: z.string(), total: n, page: n, perPage: n, totalPages: n, rows: z.array(marketCapRowSchema), notFound: z.array(z.string()) });
export type MarketCapRow = z.infer<typeof marketCapRowSchema>;
export type MarketCapQuery = { page?: number; perPage?: number; date?: string; symbols?: string[] };

const sym = (symbol: string) => encodeURIComponent(symbol.toUpperCase());

export type HistoryQuery = { frame?: string; limit?: number; startDate?: string; endDate?: string };

/** Query string from defined values only. */
function qs(values: Record<string, string | number | boolean | undefined | null>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== "" && value !== false) params.set(key, String(value));
  return params.size ? `?${params}` : "";
}

export const marketApi = {
  search: (q: string, signal?: AbortSignal) => fetchEnvelope(`/api/search?q=${encodeURIComponent(q)}`, z.array(searchResultSchema), { signal }),
  history: (symbol: string, query: HistoryQuery = {}, signal?: AbortSignal) =>
    fetchEnvelope(`/api/history/${sym(symbol)}${qs({ frame: query.frame, limit: query.limit, start_date: query.startDate, end_date: query.endDate })}`, historySchema, { signal }),
  brokerSummary: (symbol: string, query: BrokerSummaryQuery = {}, signal?: AbortSignal) =>
    fetchEnvelope(`/api/broker-summary/${sym(symbol)}${qs({ start_date: query.startDate, end_date: query.endDate, flow: query.flow === "all" ? undefined : query.flow, net: query.net, broker_limit: query.brokerLimit, level_limit: query.levelLimit })}`, brokerSummarySchema, { signal }),
  brokerDirectory: (signal?: AbortSignal) => fetchEnvelope("/api/brokers/directory", brokerDirectorySchema, { signal }),
  /** Strategy Engine contract (src/lib/strategies/contract.ts), whichever engines are registered. */
  strategies: (signal?: AbortSignal) => fetchEnvelope("/api/strategies", strategyBoardSchema, { signal }),
  insiders: (symbol: string, signal?: AbortSignal) => fetchEnvelope(`/api/insiders/${sym(symbol)}`, insidersSchema, { signal }),
  marketCap: (query: MarketCapQuery = {}, signal?: AbortSignal) =>
    fetchEnvelope(`/api/market-cap${qs({ page: query.page, per_page: query.perPage, date: query.date, symbols: query.symbols?.join(",") })}`, marketCapSchema, { signal }),
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
export const newsItemSchema = z.object({ date: z.string().nullable(), title: z.string().nullable(), summary: z.string().nullable(), url: z.string().nullable(), symbols: z.array(z.string()).optional() });

export const announcementSchema = z.object({ date: z.string().nullable(), symbol: z.string().nullable(), title: z.string().nullable(), documentUrl: z.string().nullable() });

export const overviewApi = {
  stock: (symbol: string, signal?: AbortSignal) => fetchEnvelope(`/api/overview/${encodeURIComponent(symbol.toUpperCase())}`, stockOverviewSchema, { signal }),
  market: (signal?: AbortSignal) => fetchEnvelope("/api/market", marketOverviewSchema, { signal }),
  news: (signal?: AbortSignal, perPage = 8) => fetchEnvelope(`/api/news?per_page=${perPage}`, z.array(newsItemSchema), { signal }),
  announcements: (keywords: string, signal?: AbortSignal) => fetchEnvelope(`/api/announcements?per_page=30${keywords ? `&keywords=${encodeURIComponent(keywords)}` : ""}`, z.array(announcementSchema), { signal }),
};

// --- Quotes (/api/quotes) ------------------------------------------------------------------
export const MARKET_STATES = ["open", "break", "closed", "holiday", "weekend", "unknown"] as const;
export type MarketState = (typeof MARKET_STATES)[number];
export const quoteSchema = z.discriminatedUnion("status", [
  z.object({ symbol: z.string(), status: z.literal("ok"), date: z.string(), close: n, change: nn, changePercent: nn, lastTradeTime: z.string().nullable(), marketState: z.enum(MARKET_STATES).nullable(), ...freshnessFields }),
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
  get: (symbol: string, query: { startDate?: string; endDate?: string; top?: number; brokers?: string[] }, signal?: AbortSignal) =>
    fetchEnvelope(`/api/broker-accumulation/${sym(symbol)}${qs({ start_date: query.startDate, end_date: query.endDate, top: query.top, brokers: query.brokers?.join(",") })}`, brokerAccumulationSchema, { signal }),
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
export type FinancialsQuery = { reportType: ReportType; period: "quarterly" | "annual"; limit: number; year?: string | null };
export const financialsApi = {
  get: (symbol: string, query: FinancialsQuery, signal?: AbortSignal) =>
    fetchEnvelope(`/api/financial-statements/${sym(symbol)}${qs({ report_type: query.reportType, period: query.period, limit: query.limit, year: query.year })}`, financialStatementsSchema, { signal }),
};

// --- Screener (POST /api/screener, idx-bei lane) ---------------------------------------------
export const SCREEN_FIELDS = ["price", "volume", "value", "frequency", "foreignNetShares", "foreignNetValue", "relativeVolume", "pctFromHigh", "marketCap", "per", "pbv", "roe", "roa", "eps", "der", "dividendYield", "change1D"] as const;
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

// --- Done details, profile, corporate actions, paged insiders --------------------------------
export const doneDetailsSchema = z.object({
  symbol: z.string(), date: z.string(), total: n, page: n, perPage: n, totalPages: n,
  rows: z.array(z.object({ time: z.string(), board: z.string(), priceIdr: n, lots: n, valueIdr: n, buyer: z.string(), seller: z.string(), buyerType: z.string(), sellerType: z.string(), aggressor: z.string() })),
});
export type DoneDetailRow = z.infer<typeof doneDetailsSchema>["rows"][number];
export const seasonalitySchema = z.object({
  symbol: z.string(), months: z.array(z.string()), coverage: z.object({ from: z.string(), to: z.string() }).nullable(),
  rows: z.array(z.object({ year: z.string(), averagePercent: nn, valuesPercent: z.array(nn) })),
  summary: z.array(z.object({ month: z.string(), averagePercent: nn, upProbability: nn, samples: n })),
});
export type Seasonality = z.infer<typeof seasonalitySchema>;
/** IDX company-detail records (keys verified upstream: Nama, Jabatan, Persentase, Kategori). ID numbers are stripped server-side. */
const personRecord = z.record(z.string(), z.unknown());
export const profileSchema = z.object({
  symbol: z.string(), companyName: z.string().nullable(), website: z.string().nullable(), description: z.string().nullable(),
  directors: z.array(personRecord), commissioners: z.array(personRecord), shareholders: z.array(personRecord), subsidiaries: z.array(personRecord),
  /** When HAKAPRO retrieved the snapshot (not a disclosure date) and which dataset it came from. */
  retrievedAt: z.string(), dataset: z.string().nullable(),
  /** Upstream capture time of a dated snapshot (IDX-BEI); absent for undated IDX company details. */
  capturedAt: z.string().nullable().optional(),
});
export type CompanyProfile = z.infer<typeof profileSchema>;
export const corporateActionSchema = z.object({ date: z.string().nullable(), type: z.string().nullable(), description: z.string().nullable(), documentUrl: z.string().nullable() });

// --- Data Engine: sectors, corporate-action calendar, KSEI ≥1% ownership ----------------------------------------
export const sectorPerformanceSchema = z.object({
  sector: z.string(), stocks: n, advancers: n, decliners: n, unchanged: n, changePercent: n, valueWeightedChangePercent: nn, valueIdr: n,
  leader: z.object({ symbol: z.string(), changePercent: nn }), laggard: z.object({ symbol: z.string(), changePercent: nn }),
});
export type SectorPerformance = z.infer<typeof sectorPerformanceSchema>;
/** Heatmap (Data Engine): changes in percentage points; `netForeignValueEstimateIdr` is an ESTIMATE, null without foreign data. */
export const heatmapStockSchema = z.object({
  symbol: z.string(), name: z.string().nullable(), sector: z.string().nullable(), close: nn, changePercent: nn,
  valueIdr: nn, volumeShares: nn, netForeignValueEstimateIdr: nn,
});
export const heatmapSectorSchema = z.object({
  sector: z.string().nullable(), stocks: n, advancers: n, decliners: n, unchanged: n, valueIdr: n, changePercent: nn, netForeignValueEstimateIdr: nn,
});
export const heatmapSchema = z.object({ limit: n, stocks: z.array(heatmapStockSchema), sectors: z.array(heatmapSectorSchema) });
export type HeatmapStock = z.infer<typeof heatmapStockSchema>;
export type HeatmapSector = z.infer<typeof heatmapSectorSchema>;
export type Heatmap = z.infer<typeof heatmapSchema>;

// Macro / commodity series (/api/macro): BI-Rate and JISDOR (daily), World Bank commodities `wb.*` (monthly).
export const macroSeriesSchema = z.object({
  id: z.string(), name: z.string(), unit: z.string(), date: z.string(), value: z.number(),
  previousDate: z.string().nullable(), previousValue: z.number().nullable(), link: z.string().nullable(),
  observations: z.array(z.object({ date: z.string(), value: z.number() })),
});
export const macroSchema = z.object({ series: z.array(macroSeriesSchema) });
export type MacroSeries = z.infer<typeof macroSeriesSchema>;
export type Macro = z.infer<typeof macroSchema>;

export const GROUP_WINDOWS = ["1D", "5D", "20D"] as const;
export type GroupWindow = (typeof GROUP_WINDOWS)[number];
const groupConfidence = z.enum(["sourced", "unverified"]);
const groupDivergence = z.enum(["price_up_foreign_net_sell", "price_down_foreign_net_buy"]).nullable();
export const groupStockSchema = z.object({
  symbol: z.string(), name: z.string().nullable(), confidence: groupConfidence, note: z.string().nullable(),
  close: nn, changePercent: nn, valueIdr: nn, sessions: n, corporateAction: z.boolean(),
  netForeignValueEstimateIdr: nn, foreignSessions: n, divergence: groupDivergence,
});
export const groupPerformanceSchema = z.object({
  id: z.string(), name: z.object({ id: z.string(), en: z.string() }), confidence: groupConfidence, note: z.string().nullable(), reviewedAt: z.string(),
  sources: z.array(z.object({ label: z.string(), url: z.string() })),
  members: n, membersWithData: n, unknownSymbols: z.array(z.string()), inactiveSymbols: z.array(z.string()), noDataSymbols: z.array(z.string()),
  advancers: n, decliners: n, unchanged: n, changePercent: nn, valueWeightedChangePercent: nn, valueIdr: n,
  foreign: z.object({ netValueEstimateIdr: nn, members: n, partialMembers: n }),
  divergence: groupDivergence,
  best: z.object({ symbol: z.string(), changePercent: n }).nullable(), worst: z.object({ symbol: z.string(), changePercent: n }).nullable(),
  stocks: z.array(groupStockSchema),
});
export const groupsViewSchema = z.object({
  window: z.object({ id: z.enum(GROUP_WINDOWS), sessions: n, from: z.string().nullable(), to: z.string().nullable(), basis: z.enum(["daily", "intraday"]) }),
  catalog: z.object({ version: z.string(), reviewedAt: z.string() }),
  groups: z.array(groupPerformanceSchema),
});
export type GroupStock = z.infer<typeof groupStockSchema>;
export type GroupPerformance = z.infer<typeof groupPerformanceSchema>;
export type GroupsView = z.infer<typeof groupsViewSchema>;
export const actionCalendarItemSchema = z.object({
  symbol: z.string(), date: z.string(), type: z.string(), description: z.string().nullable(), amount: nn, ratio: z.string().nullable(), documentUrl: z.string().nullable(),
});
export type ActionCalendarItem = z.infer<typeof actionCalendarItemSchema>;
/** Shares and percents arrive as decimal strings (exact); they are formatted, never summed, on the client. */
const ownershipHolderSchema = z.object({
  holderKey: z.string(), holderName: z.string(), holderKind: z.string(), shares: z.string().nullable(), percent: z.string().nullable(),
  investorType: z.string().nullable(), localForeign: z.string().nullable(),
});
const ownershipCrossHoldingSchema = z.object({
  ownerSymbol: z.string(), ownerName: z.string(), heldSymbol: z.string(), heldName: z.string(),
  shares: z.string().nullable(), percent: z.string().nullable(), reciprocalShares: z.string().nullable(), reciprocalPercent: z.string().nullable(), snapshotDate: z.string(),
  sourceReference: z.string(), reciprocalSourceReference: z.string(),
});
export const stockOwnershipSchema = z.object({
  symbol: z.string(), issuerName: z.string().nullable(), month: z.string().nullable(), snapshotDate: z.string().nullable(), thresholdPercent: z.string().nullable(),
  issuedShares: z.string().nullable(), source: z.object({ dataset: z.string(), reference: z.string(), retrievedAt: z.string() }).nullable(),
  holders: z.array(ownershipHolderSchema), crossHoldings: z.array(ownershipCrossHoldingSchema).default([]),
});
export type StockOwnership = z.infer<typeof stockOwnershipSchema>;
export const ownershipChangeSchema = z.object({
  symbol: z.string(), holderKey: z.string(), holderName: z.string(), holderKind: z.string(), kind: z.string(),
  sharesBefore: z.string().nullable(), sharesAfter: z.string().nullable(), shareDelta: z.string().nullable(),
  percentBefore: z.string().nullable(), percentAfter: z.string().nullable(), ppDelta: z.string().nullable(), toDate: z.string(),
});
export const ownershipChangesSchema = z.object({ month: z.string(), previousMonth: z.string(), changes: z.array(ownershipChangeSchema) });
export type OwnershipChange = z.infer<typeof ownershipChangeSchema>;
/** Market-wide insider feed (Data Engine rotation): the per-stock row plus symbol and value, and the crawl's coverage. */
export const recentInsiderSchema = insiderRowSchema.extend({ symbol: z.string(), valueIdr: nn });
export const recentInsidersSchema = z.object({
  days: n, from: z.string(), to: z.string(), action: z.enum(["buy", "sell", "cross"]).nullable(),
  coverage: z.object({ checked: n, active: n, revisitDays: n, oldestCheck: z.string().nullable() }),
  transactions: z.array(recentInsiderSchema),
});
export type RecentInsider = z.infer<typeof recentInsiderSchema>;
export type RecentInsiders = z.infer<typeof recentInsidersSchema>;
export type RecentInsidersQuery = { days?: number; action?: "buy" | "sell"; limit?: number };

// --- Data Engine: signal confluence radar and KSEI corporate holders -------------------------------------------
const radarSignalKey = z.enum(RADAR_SIGNAL_KEYS);
export const radarStockSchema = z.object({
  symbol: z.string(), name: z.string().nullable(), sector: z.string().nullable(), close: n,
  /** 1-day change in percentage points. */
  changePercent: nn, value: nn,
  fired: z.array(z.object({ key: radarSignalKey, observed: n, threshold: n, window: z.string(), detail: z.record(z.string(), nn) })),
  counter: z.array(z.object({ key: z.enum(RADAR_COUNTER_KEYS), window: z.string(), values: z.record(z.string(), nn) })),
  firedCount: n,
  status: z.record(radarSignalKey, z.enum(["ok", "missing"])),
});
export type RadarStock = z.infer<typeof radarStockSchema>;
export const radarSchema = z.object({
  tradingDate: z.string().nullable(), rulesVersion: z.string(), kseiMonth: z.string().nullable(),
  rules: z.record(radarSignalKey, z.object({ window: nn, baseline: nn, threshold: n, unit: z.enum(["fraction", "ratio", "count"]) })),
  coverage: z.object({ stocks: n, listed: n, returned: n, signals: z.record(radarSignalKey, n) }),
  stocks: z.array(radarStockSchema),
});
export type Radar = z.infer<typeof radarSchema>;
const closeAtSchema = z.object({ date: z.string(), close: n });
export const stealthStockSchema = z.object({
  symbol: z.string(), name: z.string().nullable(), fromDate: z.string(), toDate: z.string(),
  /** Integer string; shown, never recomputed. */
  combinedShareDelta: z.string(), newHolders: n,
  holders: z.array(z.object({
    holderKey: z.string(), holderName: z.string(), investorType: z.string(), kind: z.string(),
    sharesBefore: z.string().nullable(), sharesAfter: z.string().nullable(), shareDelta: z.string().nullable(),
    percentBefore: z.string().nullable(), percentAfter: z.string().nullable(), ppDelta: z.string().nullable(), flags: z.array(z.string()),
  })),
  /** Close change between the two position dates in percentage points; null when a close is not stored. */
  price: z.object({ from: closeAtSchema, to: closeAtSchema, changePercent: n }).nullable(),
});
export type StealthStock = z.infer<typeof stealthStockSchema>;
export const stealthOwnershipSchema = z.object({
  month: z.string().nullable(), previousMonth: z.string().nullable(), rulesVersion: z.string(),
  rules: z.object({ investorTypes: z.array(z.string()), maxPriceChange: n, maxCloseGapDays: n }),
  coverage: z.object({ issuers: n, corporateIncrease: n, priceRose: n, priceMissing: n }),
  stocks: z.array(stealthStockSchema),
});
export type StealthOwnership = z.infer<typeof stealthOwnershipSchema>;

/** IHSG + IDX-IC sector-index daily closes (`/api/indices/history`), for the sector-rotation RRG. */
const indexCoverageSchema = z.object({
  code: z.string(), name: z.string().nullable(), count: z.number().int(), firstDate: z.string().nullable(), lastDate: z.string().nullable(),
  spanTradingDays: z.number().int(), missingSessions: z.number().int(), staleTradingDays: z.number().int(),
  flags: z.array(z.enum(["STALE", "NON_POSITIVE_CLOSE", "UNORDERED"])),
});
export const indicesHistorySchema = z.object({
  series: z.array(z.object({ code: z.string(), name: z.string().nullable(), points: z.array(z.object({ date: z.string(), close: z.number() })) })),
  coverage: z.array(indexCoverageSchema).optional(),
});
export type IndicesHistory = z.infer<typeof indicesHistorySchema>;
export type IndexSeries = IndicesHistory["series"][number];
export type IndexCoverageReport = NonNullable<IndicesHistory["coverage"]>[number];

export const engineApi = {
  radar: (signal?: AbortSignal) => fetchEnvelope("/api/radar", radarSchema, { signal }),
  indicesHistory: (query: { codes?: string[]; from?: string; to?: string } = {}, signal?: AbortSignal) =>
    fetchEnvelope(`/api/indices/history${qs({ codes: query.codes?.join(","), from: query.from, to: query.to })}`, indicesHistorySchema, { signal }),
  stealthOwnership: (signal?: AbortSignal) => fetchEnvelope("/api/ownership/stealth", stealthOwnershipSchema, { signal }),
  sectors: (signal?: AbortSignal) => fetchEnvelope("/api/sectors", z.array(sectorPerformanceSchema), { signal }),
  heatmap: (limit: number, signal?: AbortSignal) => fetchEnvelope(`/api/heatmap${qs({ limit })}`, heatmapSchema, { signal }),
  macro: (signal?: AbortSignal) => fetchEnvelope("/api/macro", macroSchema, { signal }),
  groups: (window: GroupWindow, signal?: AbortSignal) => fetchEnvelope(`/api/groups${qs({ window })}`, groupsViewSchema, { signal }),
  actionsCalendar: (range: { from?: string; to?: string } = {}, signal?: AbortSignal) => fetchEnvelope(`/api/actions${qs(range)}`, z.array(actionCalendarItemSchema), { signal }),
  ownership: (symbol: string, signal?: AbortSignal) => fetchEnvelope(`/api/stocks/${encodeURIComponent(symbol.toUpperCase())}/ownership`, stockOwnershipSchema, { signal }),
  ownershipChanges: (query: { month?: string; symbol?: string } = {}, signal?: AbortSignal) => fetchEnvelope(`/api/ownership/changes${qs(query)}`, ownershipChangesSchema, { signal }),
  recentInsiders: (query: RecentInsidersQuery = {}, signal?: AbortSignal) => fetchEnvelope(`/api/insiders/recent${qs(query)}`, recentInsidersSchema, { signal }),
};

export const stockApi = {
  doneDetails: (symbol: string, query: { date?: string | null; page?: number } = {}, signal?: AbortSignal) =>
    fetchEnvelope(`/api/done-details${qs({ code: symbol.toUpperCase(), date: query.date, page: query.page, per_page: 100 })}`, doneDetailsSchema, { signal }),
  seasonality: (symbol: string, signal?: AbortSignal) => fetchEnvelope(`/api/seasonal/${encodeURIComponent(symbol.toUpperCase())}`, seasonalitySchema, { signal }),
  profile: (symbol: string, signal?: AbortSignal) => fetchEnvelope(`/api/stocks/${encodeURIComponent(symbol.toUpperCase())}/profile`, profileSchema, { signal }),
  actions: (symbol: string, signal?: AbortSignal) => fetchEnvelope(`/api/stocks/${encodeURIComponent(symbol.toUpperCase())}/actions`, z.array(corporateActionSchema), { signal }),
  insiders: (symbol: string, query: { page: number; limit: number; action?: string | null }, signal?: AbortSignal) =>
    fetchEnvelope(`/api/insiders/${encodeURIComponent(symbol.toUpperCase())}?page=${query.page}&limit=${query.limit}${query.action ? `&action_type=${query.action.toLowerCase()}` : ""}`, insidersSchema, { signal }),
};

// --- Today's price (/api/price/[code]) ---------------------------------------------------------
export const lastPriceSchema = z.object({
  symbol: z.string(), lastPriceIdr: n, frequency: n, lots: n, valueIdr: n,
  sessionDate: z.string().nullable(), tradedToday: z.boolean(), lastTradeTime: z.string().nullable(), servedTime: z.string(),
  marketState: z.enum(MARKET_STATES), quoteAgeMs: nn,
});
export type LastPrice = z.infer<typeof lastPriceSchema>;
export const priceApi = {
  get: (symbol: string, signal?: AbortSignal) => fetchEnvelope(`/api/price/${sym(symbol)}`, lastPriceSchema, { signal }),
};

// --- Analysis (/api/analysis/[code], /api/analysis?symbols=) -------------------------------------
const tone = z.enum(["positive", "negative", "neutral", "mixed"]).nullable();
const factorSchema = z.discriminatedUnion("key", [
  z.object({ key: z.literal("priceVsSma"), tone, position: z.enum(["above", "below"]), period: n }),
  z.object({ key: z.literal("volume"), tone, level: z.enum(["low", "normal", "high"]) }),
  z.object({ key: z.literal("foreign"), tone, side: z.enum(["buy", "sell"]) }),
  z.object({ key: z.literal("brokers"), tone, side: z.enum(["accumulation", "distribution"]) }),
  z.object({ key: z.literal("rsiZone"), tone, zone: z.enum(["oversold", "overbought"]) }),
  z.object({ key: z.literal("other"), tone }),
]);
const patternSchema = z.object({
  pattern: z.discriminatedUnion("key", [
    z.object({ key: z.literal("combination"), parts: z.array(z.enum(["broker", "foreign", "technical"])) }),
    z.object({ key: z.literal("priceVsMa"), position: z.enum(["above", "below"]), period: n }),
    z.object({ key: z.literal("foreignStrong"), side: z.enum(["buy", "sell"]) }),
    z.object({ key: z.literal("rsiRebound") }),
    z.object({ key: z.literal("rsiZone"), zone: z.enum(["oversold", "overbought"]) }),
    z.object({ key: z.literal("brokerConcentratedAccumulation") }),
    z.object({ key: z.literal("volumeClimax") }),
    z.object({ key: z.literal("other") }),
  ]),
  quality: z.enum(["historicalEdge", "validSample", "other"]),
  winRatePercent: nn, averageReturnPercent: nn, day3ReturnPercent: nn, potentialPercent: nn, drawdownPercent: nn,
  takeProfitPercent: nn, cutLossPercent: nn, timeoutPercent: nn, samples: nn, profitFactor: nn, averageExitDays: nn,
});
const brokerNetValue = z.object({ code: z.string(), netValueIdr: n });
export const ANALYSIS_STANCES = ["avoid", "reduce", "accumulate", "watch", "hold", "wait", "other"] as const;
export const stockAnalysisSchema = z.object({
  symbol: z.string(), companyName: z.string().nullable(), date: z.string().nullable(),
  price: z.object({
    closeIdr: nn, changeIdr: nn, changePercent: nn, previousCloseIdr: nn, openIdr: nn, highIdr: nn, lowIdr: nn, rangeIdr: nn, rangePercent: nn,
    pivots: z.object({ r2: nn, r1: nn, p: nn, s1: nn, s2: nn }),
  }),
  technical: z.object({
    sma: z.array(z.object({ period: n, valueIdr: n })), rsi14: nn,
    bollinger: z.object({ upperIdr: n, middleIdr: n, lowerIdr: n }).nullable(),
    macd: z.object({ macd: n, signal: n, histogram: n }).nullable(),
    atrIdr: nn, atrPercent: nn,
  }),
  volume: z.object({ shares: nn, lots: nn, valueIdr: nn, frequency: nn, average20Shares: nn, ratio: nn, trend: z.enum(["rising", "falling", "stable"]).nullable() }),
  foreign: z.object({
    side: z.enum(["buy", "sell"]).nullable(), netShares: nn, percentOfVolume: nn,
    recent: z.object({ buyDays: n, sellDays: n, sessions: n, averageNetShares: nn }).nullable(),
  }),
  brokers: z.object({
    total: nn, topBuyers: z.array(brokerNetValue), topSellers: z.array(brokerNetValue), heavyBuyers: z.array(z.string()), heavySellers: z.array(z.string()),
    consistency: z.array(z.object({ code: z.string(), side: z.enum(["buy", "sell"]), days: n, sessions: n })), moreConsistent: n,
  }),
  score: z.object({ value: n, max: n, tone }).nullable(),
  factors: z.array(factorSchema),
  patterns: z.array(patternSchema),
  outlook: z.object({
    stance: z.enum(ANALYSIS_STANCES), small: z.boolean(), conditional: z.boolean(), historicalEdge: z.boolean(),
    entry: z.object({ lowIdr: n, highIdr: n }).nullable(),
    targets: z.array(z.object({ priceIdr: n, basis: z.enum(["R1", "R2", "P", "S1", "S2", "weeklyPivot"]).nullable() })),
    stopLoss: z.object({ priceIdr: n, percent: nn }).nullable(),
  }).nullable(),
});
export type StockAnalysis = z.infer<typeof stockAnalysisSchema>;
export type AnalysisFactor = StockAnalysis["factors"][number];
export type AnalysisPattern = StockAnalysis["patterns"][number];
export const comparedAnalysisSchema = z.discriminatedUnion("status", [
  z.object({ symbol: z.string(), status: z.literal("ok"), data: stockAnalysisSchema, ...freshnessFields }),
  z.object({ symbol: z.string(), status: z.literal("error"), error: z.string() }),
]);
export type ComparedAnalysis = z.infer<typeof comparedAnalysisSchema>;
export const analysisApi = {
  get: (symbol: string, signal?: AbortSignal) => fetchEnvelope(`/api/analysis/${sym(symbol)}`, stockAnalysisSchema, { signal }),
  compare: (symbols: string[], signal?: AbortSignal) => fetchEnvelope(`/api/analysis?symbols=${symbols.map(encodeURIComponent).join(",")}`, z.array(comparedAnalysisSchema), { signal }),
};
