import type { WithFreshness } from "@/lib/freshness";
import { unsupported } from "./errors";
import type {
  AnnouncementItem, BrokerAccumulation, BrokerSummary, CompanyProfile, CorporateAction, DoneDetails, FinancialStatements,
  ForeignFlow, FundamentalPeriod, History, Insiders, MarketCap, MarketOverview, NewsItem, ScreenRequest, ScreenResult,
  SearchResult, Seasonality, Security, StockSnapshot, StrategyScreen,
} from "./types";

export type HistoryQuery = { limit?: number; frame?: "daily" | "weekly" | "monthly" };
export type BrokerAccumulationQuery = { startDate?: string; endDate?: string; top?: number; brokers?: string[] };
export type PageQuery = { page?: number; perPage?: number };
export type FinancialsQuery = { reportType?: "INCOME_STATEMENT" | "BALANCE_SHEET" | "CASH_FLOW"; period?: "quarterly" | "annual"; limit?: number; year?: string };
export type InsidersQuery = { page?: number; limit?: number; actionType?: "buy" | "sell" | "cross" };

type R<T> = Promise<WithFreshness<T>>;

/**
 * The only way UI-facing code reaches market data. Implementations: arjum, idx-bei, fixture
 * (and composites). A source that lacks a capability throws MarketDataError("UNSUPPORTED").
 */
export interface MarketDataSource {
  readonly id: string;
  // arjum lane
  search(q: string, signal?: AbortSignal): R<SearchResult[]>;
  strategies(signal?: AbortSignal): R<StrategyScreen>;
  brokerSummary(symbol: string, signal?: AbortSignal): R<BrokerSummary>;
  brokerAccumulation(symbol: string, query: BrokerAccumulationQuery, signal?: AbortSignal): R<BrokerAccumulation>;
  history(symbol: string, query: HistoryQuery, signal?: AbortSignal): R<History>;
  seasonality(symbol: string, signal?: AbortSignal): R<Seasonality>;
  marketCap(query: PageQuery & { date?: string }, signal?: AbortSignal): R<MarketCap>;
  financialStatements(symbol: string, query: FinancialsQuery, signal?: AbortSignal): R<FinancialStatements>;
  insiders(symbol: string, query: InsidersQuery, signal?: AbortSignal): R<Insiders>;
  doneDetails(symbol: string, query: PageQuery & { date?: string }, signal?: AbortSignal): R<DoneDetails>;
  providerHealth(signal?: AbortSignal): R<{ ok: boolean; status: string }>;
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
  async providerHealth(..._args: unknown[]): R<{ ok: boolean; status: string }> { return this.fail("providerHealth"); }
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
}
