/**
 * Domain types shared by every MarketDataSource. Units are explicit in field names or docs:
 * shares vs lots, IDR, and percent units (1.25 = 1.25%), never fractions.
 */
import type { NewsItem, AnnouncementItem, Radar, ScreenRequest, StealthOwnership as StealthOwnershipData } from "@/server/schemas/idx-bei";
export type {
  BrokerAccumulation, BrokerFlow, BrokerSummary, DoneDetails, FinancialStatements, History, Insiders, LastPrice, MarketCap, SearchResult, Seasonality,
} from "@/server/services/arjum-normalize";
export type { StockAnalysis } from "@/server/services/analysis-parse";
export type { StrategyScreen } from "@/server/services/why-matched";
export type { NewsItem, AnnouncementItem, ScreenRequest };

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
/** One market-wide corporate action by ex-date (Data Engine calendar). */
export type ActionCalendarItem = { symbol: string; date: string; type: string; description: string | null; amount: number | null; ratio: string | null; documentUrl: string | null };
export type { OwnershipChanges, StockOwnership } from "@/server/schemas/ownership";
/**
 * Signal confluence radar (Data Engine `/v1/radar`). As the engine sends it, except each stock's 1-day
 * `changePercent`, which is in percentage points like the rest of the app. Signal values keep their rule's unit
 * (fraction, ratio or count; src/lib/radar/rules.ts).
 */
export type RadarSnapshot = Radar;
/** KSEI corporate holders up while the close was flat or lower (Data Engine `/v1/ownership/stealth`); price change in percentage points. */
export type StealthOwnership = StealthOwnershipData;
