import type { WithFreshness } from "@/lib/freshness";
import { unsupported } from "./errors";
import type {
  ActionCalendarItem, AnnouncementItem, BrokerAccumulation, BrokerFlow, BrokerSummary, CompanyProfile, CorporateAction, DoneDetails,
  FinancialStatements, ForeignFlow, FundamentalPeriod, Heatmap, History, Insiders, LastPrice, MarketCap, MarketOverview, NewsItem, ScreenRequest,
  ScreenResult, OwnershipChanges, RecentInsiders, SearchResult, Seasonality, SectorPerformance, Security, StockAnalysis, StockOwnership,
  StockSnapshot, StrategyScreen, GroupsView, GroupWindow,
} from "./types";

export type HistoryQuery = { limit?: number; frame?: "daily" | "weekly" | "monthly"; startDate?: string; endDate?: string };
/** Without dates the provider returns its latest session. Limits cap the broker list and the paired buy/sell levels. */
export type BrokerSummaryQuery = { startDate?: string; endDate?: string; flow?: BrokerFlow; net?: boolean; brokerLimit?: number; levelLimit?: number };
/** With `symbols`, only those stocks are returned and paging is ignored by the provider. */
export type MarketCapQuery = { page?: number; perPage?: number; date?: string; symbols?: string[] };
export type BrokerAccumulationQuery = { startDate?: string; endDate?: string; top?: number; brokers?: string[] };
export type PageQuery = { page?: number; perPage?: number };
export type FinancialsQuery = { reportType?: "INCOME_STATEMENT" | "BALANCE_SHEET" | "CASH_FLOW"; period?: "quarterly" | "annual"; limit?: number; year?: string };
/** Ex-date range (YYYY-MM-DD, inclusive); without it the provider picks its default window around today. */
export type ActionsCalendarQuery = { from?: string; to?: string };
/** The session window; 1D when omitted. */
export type GroupsQuery = { window?: GroupWindow };
/** Without month, the newest month the provider has. */
export type OwnershipChangesQuery = { month?: string; symbol?: string };
/** How many of the most-traded stocks to cover (30, 50 or 100; the provider's default is 100). */
export type HeatmapQuery = { limit?: 30 | 50 | 100 };
export type InsidersQuery = { page?: number; limit?: number; actionType?: "buy" | "sell" | "cross" };
/** Market-wide feed: transactions dated within the last `days` (provider default 7), optionally one action, at most `limit`. */
export type RecentInsidersQuery = { days?: number; action?: "buy" | "sell" | "cross"; limit?: number };

type R<T> = Promise<WithFreshness<T>>;

/** Provider status plus its daily request quota as last reported in response headers (null until seen). */
export type ProviderHealth = { ok: boolean; status: string; quota: { limit: number; remaining: number; observedAt: string } | null };

/**
 * The only way UI-facing code reaches market data. Implementations: arjum, idx-bei, fixture
 * (and composites). A source that lacks a capability throws MarketDataError("UNSUPPORTED").
 */
export interface MarketDataSource {
  readonly id: string;
  // arjum lane
  search(q: string, signal?: AbortSignal): R<SearchResult[]>;
  strategies(signal?: AbortSignal): R<StrategyScreen>;
  brokerSummary(symbol: string, query?: BrokerSummaryQuery, signal?: AbortSignal): R<BrokerSummary>;
  brokerAccumulation(symbol: string, query: BrokerAccumulationQuery, signal?: AbortSignal): R<BrokerAccumulation>;
  history(symbol: string, query: HistoryQuery, signal?: AbortSignal): R<History>;
  seasonality(symbol: string, signal?: AbortSignal): R<Seasonality>;
  marketCap(query: MarketCapQuery, signal?: AbortSignal): R<MarketCap>;
  financialStatements(symbol: string, query: FinancialsQuery, signal?: AbortSignal): R<FinancialStatements>;
  insiders(symbol: string, query: InsidersQuery, signal?: AbortSignal): R<Insiders>;
  doneDetails(symbol: string, query: PageQuery & { date?: string }, signal?: AbortSignal): R<DoneDetails>;
  providerHealth(signal?: AbortSignal): R<ProviderHealth>;
  /** Today's last price and running totals (not a realtime tick). */
  price(symbol: string, signal?: AbortSignal): R<LastPrice>;
  /** Structured technical/flow analysis (numbers and categories only, never provider wording). */
  analysis(symbol: string, signal?: AbortSignal): R<StockAnalysis>;
  // idx-bei lane
  marketOverview(): R<MarketOverview>;
  stock(symbol: string): R<StockSnapshot>;
  fundamentals(symbol: string): R<FundamentalPeriod[]>;
  corporateActions(symbol: string): R<CorporateAction[]>;
  profile(symbol: string): R<CompanyProfile>;
  securities(q: string): R<Security[]>;
  foreignFlow(): R<ForeignFlow>;
  screen(request: ScreenRequest): R<ScreenResult>;
  news(query: PageQuery): R<NewsItem[]>;
  announcements(query: PageQuery & { keywords?: string }): R<AnnouncementItem[]>;
  // Data Engine lane
  sectors(): R<SectorPerformance[]>;
  /** The most-traded stocks of the newest view with per-sector totals (net foreign value is an estimate). */
  heatmap(query: HeatmapQuery): R<Heatmap>;
  /** Curated conglomerate groups measured over a session window (measured facts, no phase or action labels). */
  groups(query: GroupsQuery): R<GroupsView>;
  actionsCalendar(query: ActionsCalendarQuery): R<ActionCalendarItem[]>;
  /** The newest KSEI ≥1% list the owner uploaded for a symbol (empty form when none). */
  ownership(symbol: string): R<StockOwnership>;
  ownershipChanges(query: OwnershipChangesQuery): R<OwnershipChanges>;
  /** Market-wide insider transactions from a rotating crawl, with how much of the market it covers (empty form before the first read). */
  recentInsiders(query: RecentInsidersQuery): R<RecentInsiders>;
}

export type Capability = Exclude<keyof MarketDataSource, "id">;

/** Base class: every capability is unsupported until a subclass overrides it. */
export abstract class BaseMarketDataSource implements MarketDataSource {
  abstract readonly id: string;
  protected fail(capability: Capability): never {
    throw unsupported(this.id, capability);
  }
  async search(..._args: unknown[]): R<SearchResult[]> { return this.fail("search"); }
  async strategies(..._args: unknown[]): R<StrategyScreen> { return this.fail("strategies"); }
  async brokerSummary(..._args: unknown[]): R<BrokerSummary> { return this.fail("brokerSummary"); }
  async brokerAccumulation(..._args: unknown[]): R<BrokerAccumulation> { return this.fail("brokerAccumulation"); }
  async history(..._args: unknown[]): R<History> { return this.fail("history"); }
  async seasonality(..._args: unknown[]): R<Seasonality> { return this.fail("seasonality"); }
  async marketCap(..._args: unknown[]): R<MarketCap> { return this.fail("marketCap"); }
  async financialStatements(..._args: unknown[]): R<FinancialStatements> { return this.fail("financialStatements"); }
  async insiders(..._args: unknown[]): R<Insiders> { return this.fail("insiders"); }
  async doneDetails(..._args: unknown[]): R<DoneDetails> { return this.fail("doneDetails"); }
  async providerHealth(..._args: unknown[]): R<ProviderHealth> { return this.fail("providerHealth"); }
  async price(..._args: unknown[]): R<LastPrice> { return this.fail("price"); }
  async analysis(..._args: unknown[]): R<StockAnalysis> { return this.fail("analysis"); }
  async marketOverview(..._args: unknown[]): R<MarketOverview> { return this.fail("marketOverview"); }
  async stock(..._args: unknown[]): R<StockSnapshot> { return this.fail("stock"); }
  async fundamentals(..._args: unknown[]): R<FundamentalPeriod[]> { return this.fail("fundamentals"); }
  async corporateActions(..._args: unknown[]): R<CorporateAction[]> { return this.fail("corporateActions"); }
  async profile(..._args: unknown[]): R<CompanyProfile> { return this.fail("profile"); }
  async securities(..._args: unknown[]): R<Security[]> { return this.fail("securities"); }
  async foreignFlow(..._args: unknown[]): R<ForeignFlow> { return this.fail("foreignFlow"); }
  async screen(..._args: unknown[]): R<ScreenResult> { return this.fail("screen"); }
  async news(..._args: unknown[]): R<NewsItem[]> { return this.fail("news"); }
  async announcements(..._args: unknown[]): R<AnnouncementItem[]> { return this.fail("announcements"); }
  async sectors(..._args: unknown[]): R<SectorPerformance[]> { return this.fail("sectors"); }
  async heatmap(..._args: unknown[]): R<Heatmap> { return this.fail("heatmap"); }
  async groups(..._args: unknown[]): R<GroupsView> { return this.fail("groups"); }
  async actionsCalendar(..._args: unknown[]): R<ActionCalendarItem[]> { return this.fail("actionsCalendar"); }
  async ownership(..._args: unknown[]): R<StockOwnership> { return this.fail("ownership"); }
  async ownershipChanges(..._args: unknown[]): R<OwnershipChanges> { return this.fail("ownershipChanges"); }
  async recentInsiders(..._args: unknown[]): R<RecentInsiders> { return this.fail("recentInsiders"); }
}
