/**
 * Domain types shared by every MarketDataSource. Units are explicit in field names or docs:
 * shares vs lots, IDR, and percent units (1.25 = 1.25%), never fractions.
 */
import type { NewsItem, AnnouncementItem, ScreenRequest, Radar, StealthOwnership as StealthOwnershipData, Macro, IndicesHistory, MarketBrokerSummary, BrokerDirectory } from "@/server/schemas/idx-bei";
import type { InsiderRow } from "@/server/services/arjum-normalize";
export type {
  BrokerAccumulation, BrokerFlow, BrokerSummary, DoneDetails, FinancialStatements, History, Insiders, LastPrice, MarketCap, SearchResult, Seasonality,
} from "@/server/services/arjum-normalize";
export type { StockAnalysis } from "@/server/services/analysis-parse";
export type { StrategyScreen } from "@/server/services/why-matched";
export type { NewsItem, AnnouncementItem, ScreenRequest, Macro, IndicesHistory, MarketBrokerSummary, BrokerDirectory };

export type Quote = {
  symbol: string;
  /** Trading date (YYYY-MM-DD) of the quote. */
  date: string;
  open: number | null; high: number | null; low: number | null; close: number | null;
  previousClose: number | null; change: number | null;
  changePercent: number | null;
  volumeShares: number | null; valueIdr: number | null; frequency: number | null;
  foreignBuyShares: number | null; foreignSellShares: number | null;
};

export type Candle = {
  date: string;
  open: number | null; high: number | null; low: number | null; close: number;
  volumeShares: number | null; foreignBuyShares: number | null; foreignSellShares: number | null;
};

export type StockSnapshot = { quote: Quote; candles: Candle[] };

export type MarketOverview = {
  indices: Array<{ code: string | null; name: string | null; close: number | null; previousClose: number | null; changePercent: number | null }>;
  breadth: { advancers: number; decliners: number; unchanged: number; valueIdr: number; volumeShares: number; frequency: number };
  movers: Array<{ symbol: string | null; name: string | null; close: number | null; changePercent: number | null; volumeShares: number | null; valueIdr: number | null; frequency: number | null }>;
};

/** Observed foreign flow over consecutive sessions. `direction` is descriptive, not a signal. */
export type ForeignFlowRow = {
  symbol: string; close: number | null; sessions: number;
  netForeignShares: number | null; percentOfFloat: number | null; averageValueIdr: number | null;
  direction: "net_buy" | "net_sell";
};
export type ForeignFlow = { tradingDate: string; rows: ForeignFlowRow[] };

export type Security = { symbol: string; companyName: string; sector: string | null; subsector: string | null; board: string | null };
export type FundamentalPeriod = { periodDate: string | null; periodType: string; metrics: Record<string, number | null> };
export type CompanyProfile = {
  symbol: string; companyName: string | null; website: string | null; description: string | null;
  directors: Array<Record<string, unknown>>; commissioners: Array<Record<string, unknown>>;
  shareholders: Array<Record<string, unknown>>; subsidiaries: Array<Record<string, unknown>>;
  /** When HAKAPRO retrieved the snapshot (ISO) — not a disclosure date — and the upstream dataset name. */
  retrievedAt: string; dataset: string | null;
};
export type CorporateAction = { date: string | null; type: string | null; description: string | null; documentUrl: string | null };
export type ScreenResult = { rows: Array<{ symbol: string; name: string | null } & Record<string, number | string | null>>; total: number; supportedFields: string[] };

/** Per-sector performance of the newest session (Data Engine). Changes are percentage points, value in IDR. */
export type SectorPerformance = {
  sector: string; stocks: number; advancers: number; decliners: number; unchanged: number;
  changePercent: number; valueWeightedChangePercent: number | null; valueIdr: number;
  leader: { symbol: string; changePercent: number | null }; laggard: { symbol: string; changePercent: number | null };
};
/**
 * The most-traded stocks of the newest view with per-sector totals (Data Engine heatmap). Changes are percentage
 * points, values IDR, volume shares. `netForeignValueEstimateIdr` is an ESTIMATE ((foreign buy − sell) shares × close),
 * null when the stock has no foreign data (outside the provider budget, or an intraday view). `sector` null = unknown.
 */
export type HeatmapStock = {
  symbol: string; name: string | null; sector: string | null; close: number | null; changePercent: number | null;
  valueIdr: number | null; volumeShares: number | null; netForeignValueEstimateIdr: number | null;
};
export type HeatmapSector = {
  sector: string | null; stocks: number; advancers: number; decliners: number; unchanged: number;
  valueIdr: number; changePercent: number | null; netForeignValueEstimateIdr: number | null;
};
export type Heatmap = { limit: number; stocks: HeatmapStock[]; sectors: HeatmapSector[] };
/** Measured over a session window (Data Engine `/v1/groups`). */
export type GroupWindow = "1D" | "5D" | "20D";
export type GroupConfidence = "sourced" | "unverified";
/** Price and the foreign estimate pointing opposite ways (null when they agree or either is zero/unknown). */
export type GroupDivergence = "price_up_foreign_net_sell" | "price_down_foreign_net_buy" | null;
export type GroupStock = {
  symbol: string; name: string | null; confidence: GroupConfidence; note: string | null;
  close: number | null; changePercent: number | null; valueIdr: number | null; sessions: number; corporateAction: boolean;
  netForeignValueEstimateIdr: number | null; foreignSessions: number; divergence: GroupDivergence;
};
/** One curated conglomerate group over the window. Changes are percentage points, values IDR. */
export type GroupPerformance = {
  id: string; name: { id: string; en: string }; confidence: GroupConfidence; note: string | null; reviewedAt: string;
  sources: Array<{ label: string; url: string }>;
  members: number; membersWithData: number; unknownSymbols: string[]; inactiveSymbols: string[]; noDataSymbols: string[];
  advancers: number; decliners: number; unchanged: number;
  changePercent: number | null; valueWeightedChangePercent: number | null; valueIdr: number;
  /** Σ (foreign buy − sell shares) × close: an estimate, over `members` fully covered members. */
  foreign: { netValueEstimateIdr: number | null; members: number; partialMembers: number };
  divergence: GroupDivergence;
  best: { symbol: string; changePercent: number } | null; worst: { symbol: string; changePercent: number } | null;
  stocks: GroupStock[];
};
export type GroupsView = {
  window: { id: GroupWindow; sessions: number; from: string | null; to: string | null; basis: "daily" | "intraday" };
  catalog: { version: string; reviewedAt: string };
  groups: GroupPerformance[];
};
/** One market-wide corporate action by ex-date (Data Engine calendar). */
export type ActionCalendarItem = { symbol: string; date: string; type: string; sourceCategory?: string | null; description: string | null; amount: number | null; ratio: string | null; shares?: number | null; sharesAfter?: number | null; documentUrl: string | null };
export type { OwnershipChanges, StockOwnership } from "@/server/schemas/ownership";
/** One insider transaction in the market-wide feed: the per-stock row plus its symbol and |shares| × price (IDR). */
export type RecentInsiderTransaction = InsiderRow & { symbol: string; valueIdr: number | null };
/**
 * Market-wide insider transactions dated `from`–`to` (Data Engine rotation over arjum). `coverage`: `checked` of `active`
 * stocks were read within the last `revisitDays` days, the oldest such read on `oldestCheck`.
 */
export type RecentInsiders = {
  days: number; from: string; to: string; action: "buy" | "sell" | "cross" | null;
  coverage: { checked: number; active: number; revisitDays: number; oldestCheck: string | null };
  transactions: RecentInsiderTransaction[];
};
/**
 * Signal confluence radar (Data Engine `/v1/radar`). As the engine sends it, except each stock's 1-day
 * `changePercent`, which is in percentage points like the rest of the app. Signal values keep their rule's unit
 * (fraction, ratio or count; src/lib/radar/rules.ts).
 */
export type RadarSnapshot = Radar;
/** KSEI corporate holders up while the close was flat or lower (Data Engine `/v1/ownership/stealth`); price change in percentage points. */
export type StealthOwnership = StealthOwnershipData;
