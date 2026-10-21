import "server-only";
import type { z } from "zod";
import { classifySessionDate, withFreshness, type Freshness, type WithFreshness } from "@/lib/freshness";
import { strategyBoardSchema } from "@/lib/strategies/contract";
import {
  actionsCalendarSchema, actionsSchema, announcementItemSchema, fundamentalsSchema, idxBeiEnvelope, insidersRecentSchema, macroSchema, marketOverviewSchema, newsItemSchema,
  profileSchema, screenRequestSchema, screenResultSchema, sectorsSchema, securitySchema, signalsSchema, stockSchema, type ScreenRequest,
} from "@/server/schemas/idx-bei";
import { symbolSchema } from "@/server/schemas/inputs";
import { ownershipChangesSchema, ownershipMonthSchema, stockOwnershipSchema } from "@/server/schemas/ownership";
import { PROVIDER_USER_AGENT } from "@/server/config/provider-identity";
import { logWarn } from "@/server/log";
import { ProviderBackoff } from "@/server/providers/backoff";
import { MarketDataError, unsupported } from "./errors";
import { BaseMarketDataSource, type ActionsCalendarQuery, type OwnershipChangesQuery, type PageQuery, type RecentInsidersQuery } from "./source";
import type { Candle, Quote } from "./types";
import type { Clock } from "./arjum-source";

const pct = (fraction: number | null | undefined) => (typeof fraction === "number" ? fraction * 100 : null);
const SCREEN_PERCENT_FIELDS = new Set<string>(["change1D", "roe", "roa", "dividendYield"]);

/** In-memory TTL cache, ported from heulatrade lib/market/providers/direct.ts. */
const TTL_MS = { securities: 3_600_000, profile: 86_400_000, news: 900_000, market: 300_000 } as const;
const cache = new Map<string, { value: unknown; at: number }>();
const sharedBackoff = new ProviderBackoff();

/**
 * idx-bei lane: the existing Python market-api (heulatrade services/market-api/app.py) at MARKET_API_URL.
 * Its `meta.freshness` (EOD if ≤7 days old) is discarded and re-derived from `dataAsOf` with the session clock.
 */
export class IdxBeiSource extends BaseMarketDataSource {
  readonly id = "idx-bei";

  constructor(
    private readonly baseUrl: string,
    private readonly clock: Clock = () => new Date(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly backoff: ProviderBackoff = sharedBackoff,
  ) {
    super();
  }

  static fromEnv(): IdxBeiSource {
    const url = process.env.MARKET_API_URL?.replace(/\/$/, "");
    if (!url) throw new MarketDataError("NOT_CONFIGURED", "Market data service is not configured", 503);
    return new IdxBeiSource(url);
  }

  /** `notFound`: the error for a 404 (a route the service has but no data behind); otherwise PROVIDER_UNAVAILABLE. */
  private async get<T extends z.ZodType>(path: string, data: T, ttl?: number, init?: RequestInit, notFound?: () => Error) {
    const key = init?.body ? null : path;
    const hit = key && ttl ? cache.get(key) : undefined;
    if (hit && Date.now() - hit.at < ttl!) return { ...(hit.value as z.infer<ReturnType<typeof idxBeiEnvelope<T>>>), retrievedAt: new Date(hit.at).toISOString() };
    this.backoff.check();
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, headers: { ...init?.headers, "user-agent": PROVIDER_USER_AGENT }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    } catch {
      throw new MarketDataError("PROVIDER_UNAVAILABLE", "Market service could not be reached", 503);
    }
    if (response.status === 429) {
      const seconds = this.backoff.trip(Number(response.headers.get("retry-after")) || undefined);
      logWarn("provider_rate_limited", { source: this.id, path, cooldownSeconds: seconds });
      throw new MarketDataError("RATE_LIMITED", "Market service rate limit reached", 429, seconds);
    }
    if (response.status === 404 && notFound) throw notFound();
    if (!response.ok) throw new MarketDataError("PROVIDER_UNAVAILABLE", `Market service returned ${response.status}`, response.status === 400 ? 400 : 503);
    const parsed = idxBeiEnvelope(data).safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new MarketDataError("MALFORMED_PROVIDER_RESPONSE", "Market response format changed", 502);
    const at = Date.now();
    if (key && ttl) cache.set(key, { value: parsed.data, at });
    return { ...parsed.data, retrievedAt: new Date(at).toISOString() };
  }

  private wrap<T>(data: T, freshness: Freshness, asOf: string | null, period?: string): WithFreshness<T> {
    return withFreshness(data, { freshness, asOf, source: this.id, period });
  }

  private snapshot<T>(data: T, asOf: string | null) {
    return this.wrap(data, classifySessionDate(asOf, this.clock()), asOf);
  }

  async marketOverview() {
    const { data, meta } = await this.get("/v1/market", marketOverviewSchema, TTL_MS.market);
    return this.snapshot({
      indices: data.indices.map((row) => ({ ...row, changePercent: pct(row.changePercent) })),
      breadth: { advancers: data.breadth.advancers, decliners: data.breadth.decliners, unchanged: data.breadth.unchanged, valueIdr: data.breadth.value, volumeShares: data.breadth.volume, frequency: data.breadth.frequency },
      movers: data.movers.map((row) => ({ symbol: row.symbol, name: row.name, close: row.close, changePercent: pct(row.changePercent), volumeShares: row.volume, valueIdr: row.value, frequency: row.frequency })),
    }, meta.dataAsOf);
  }

  async stock(symbol: string) {
    const { data, meta } = await this.get(`/v1/stocks/${encodeURIComponent(symbolSchema.parse(symbol))}?limit=1600`, stockSchema, TTL_MS.market);
    const q = data.quote;
    const quote: Quote = {
      symbol: q.symbol, date: q.timestamp.slice(0, 10), open: q.open, high: q.high, low: q.low, close: q.close,
      previousClose: q.previousClose, change: q.change, changePercent: pct(q.changePercent),
      volumeShares: q.volume, valueIdr: q.value, frequency: q.frequency, foreignBuyShares: q.foreignBuy, foreignSellShares: q.foreignSell,
    };
    const candles: Candle[] = data.candles.map((c) => ({ date: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volumeShares: c.volume, foreignBuyShares: c.foreignBuy, foreignSellShares: c.foreignSell }));
    return this.snapshot({ quote, candles }, meta.dataAsOf);
  }

  async fundamentals(symbol: string) {
    const { data, meta } = await this.get(`/v1/stocks/${encodeURIComponent(symbolSchema.parse(symbol))}/fundamentals`, fundamentalsSchema);
    return this.wrap(data, "HISTORICAL", meta.dataAsOf, data[0]?.periodDate ?? undefined);
  }

  async corporateActions(symbol: string) {
    const { data, meta } = await this.get(`/v1/stocks/${encodeURIComponent(symbolSchema.parse(symbol))}/actions`, actionsSchema);
    return this.wrap(data, "HISTORICAL", meta.dataAsOf);
  }

  async profile(symbol: string) {
    // The upstream company details carry no disclosure date, so asOf stays null (→ UNAVAILABLE). The UI labels
    // the data with when we retrieved it and from which dataset instead — never as a data date.
    // The Data Engine has no profiles (IDX, their only source, blocks it) and answers 404: unsupported, not an outage.
    const { data, meta, retrievedAt } = await this.get(`/v1/stocks/${encodeURIComponent(symbolSchema.parse(symbol))}/profile`, profileSchema, TTL_MS.profile, undefined, () => unsupported(this.id, "profile"));
    return this.wrap({ ...data, retrievedAt, dataset: meta.source }, "HISTORICAL", meta.dataAsOf);
  }

  async securities(q: string) {
    const { data, meta } = await this.get(`/v1/securities${q ? `?q=${encodeURIComponent(q)}` : ""}`, securitySchema.array(), TTL_MS.securities);
    return this.wrap(data.map((row) => ({ symbol: row.symbol, companyName: row.companyName, sector: row.sector ?? null, subsector: row.subsector ?? null, board: row.board ?? null })), "HISTORICAL", meta.dataAsOf);
  }

  async foreignFlow() {
    const { data, meta } = await this.get("/v1/signals", signalsSchema, TTL_MS.market);
    return this.snapshot({
      tradingDate: data.tradingDate,
      rows: data.foreignFlow.map((row) => ({
        symbol: row.symbol, close: row.close, sessions: row.sessions,
        netForeignShares: row.netForeignMillionShares === null ? null : row.netForeignMillionShares * 1e6,
        percentOfFloat: row.percentFloat,
        averageValueIdr: row.averageValueBillionIdr === null ? null : row.averageValueBillionIdr * 1e9,
        direction: row.signal === "accumulate" ? "net_buy" as const : "net_sell" as const,
      })),
    }, meta.dataAsOf);
  }

  async screen(request: ScreenRequest) {
    const parsed = screenRequestSchema.parse(request);
    // The engine stores changes and ratio percentages as fractions; the app uses percentage points.
    const body = { ...parsed, conditions: parsed.conditions.map((condition) => (SCREEN_PERCENT_FIELDS.has(condition.field) ? { ...condition, value: condition.value / 100 } : condition)) };
    const { data, meta } = await this.get("/v1/screener", screenResultSchema, undefined, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    const rows = data.rows.map((row) => ({
      ...row,
      change1D: pct(row.change1D), roe: pct(row.roe), roa: pct(row.roa), dividendYield: pct(row.dividendYield),
    }));
    return this.snapshot({ ...data, rows }, meta.dataAsOf);
  }

  async news(query: PageQuery) {
    const { data, meta } = await this.get(`/v1/news?page=${query.page ?? 1}&page_size=${query.perPage ?? 20}`, newsItemSchema.array(), TTL_MS.news);
    return this.wrap(data, "HISTORICAL", meta.dataAsOf);
  }

  async announcements(query: PageQuery & { keywords?: string }) {
    const params = new URLSearchParams({ page: String(query.page ?? 1), page_size: String(query.perPage ?? 20) });
    if (query.keywords) params.set("keywords", query.keywords);
    const { data, meta } = await this.get(`/v1/announcements?${params}`, announcementItemSchema.array(), TTL_MS.news);
    return this.wrap(data, "HISTORICAL", meta.dataAsOf);
  }

  /** Data Engine only (`/v1/macro`, E3): BI-Rate and JISDOR. Not a MarketDataSource capability; no UI uses it yet. */
  async macro() {
    const { data, meta } = await this.get("/v1/macro", macroSchema, TTL_MS.news);
    return this.snapshot(data, meta.dataAsOf);
  }

  /** Data Engine `/v1/sectors`: per-sector performance of the newest session, the same rows as the movers. */
  async sectors() {
    const { data, meta } = await this.get("/v1/sectors", sectorsSchema, TTL_MS.market);
    return this.snapshot(data.map((row) => ({
      sector: row.sector, stocks: row.stocks, advancers: row.advancers, decliners: row.decliners, unchanged: row.unchanged,
      changePercent: row.changePercent * 100, valueWeightedChangePercent: pct(row.valueWeightedChangePercent), valueIdr: row.value,
      leader: { symbol: row.leader.symbol, changePercent: pct(row.leader.changePercent) }, laggard: { symbol: row.laggard.symbol, changePercent: pct(row.laggard.changePercent) },
    })), meta.dataAsOf);
  }

  /** Data Engine `/v1/actions`: market-wide corporate actions by ex-date (the engine's window when no range is given). */
  async actionsCalendar(query: ActionsCalendarQuery) {
    const params = new URLSearchParams();
    if (query.from) params.set("from", query.from);
    if (query.to) params.set("to", query.to);
    const { data, meta } = await this.get(`/v1/actions${params.size ? `?${params}` : ""}`, actionsCalendarSchema, TTL_MS.news);
    return this.wrap(data.map((row) => ({ ...row, amount: row.amount ?? null })), "HISTORICAL", meta.dataAsOf);
  }

  /**
   * Data Engine `/v1/stocks/{s}/ownership` (E6): the newest uploaded KSEI ≥1% list month for a symbol, dated by its
   * position date (HISTORICAL). Internal use only: the data is not licensed for a public HAKAPRO.
   */
  async ownership(symbol: string) {
    const { data, meta } = await this.get(`/v1/stocks/${encodeURIComponent(symbolSchema.parse(symbol))}/ownership`, stockOwnershipSchema, TTL_MS.securities);
    return this.wrap(data, "HISTORICAL", meta.dataAsOf);
  }

  /** Data Engine `/v1/ownership/changes` (E6): per-holder changes into `month` (the newest stored month without one). */
  async ownershipChanges(query: OwnershipChangesQuery) {
    const params = new URLSearchParams();
    if (query.month) params.set("month", ownershipMonthSchema.parse(query.month));
    if (query.symbol) params.set("symbol", symbolSchema.parse(query.symbol));
    const { data, meta } = await this.get(`/v1/ownership/changes${params.size ? `?${params}` : ""}`, ownershipChangesSchema, TTL_MS.securities);
    return this.wrap(data, "HISTORICAL", meta.dataAsOf);
  }

  /**
   * Data Engine `/v1/insiders/recent`: market-wide insider transactions from the engine's rotating arjum crawl, with its
   * coverage. Dated by the newest read (HISTORICAL); the empty form (UNAVAILABLE) before the first read.
   */
  async recentInsiders(query: RecentInsidersQuery) {
    const params = new URLSearchParams();
    if (query.days) params.set("days", String(query.days));
    if (query.action) params.set("action", query.action);
    if (query.limit) params.set("limit", String(query.limit));
    const { data, meta } = await this.get(`/v1/insiders/recent${params.size ? `?${params}` : ""}`, insidersRecentSchema, TTL_MS.news);
    return this.wrap({
      days: data.days, from: data.from, to: data.to, action: data.action, coverage: data.coverage,
      transactions: data.transactions.map((row) => ({
        symbol: row.symbol, person: row.person, date: row.date, action: row.action, roles: row.roles, broker: row.broker, nationality: row.nationality ?? "",
        previousShares: row.sharesBefore, currentShares: row.sharesAfter, changeShares: row.sharesChange,
        previousPercent: row.percentBefore, currentPercent: row.percentAfter, changePercent: row.percentChange,
        priceIdr: row.price, valueIdr: row.value,
      })),
    }, "HISTORICAL", meta.dataAsOf);
  }

  /**
   * Data Engine only (`/v1/strategies`, E4): the EOD strategy scan as a HAKA-18 board. Freshness is re-derived from the
   * scan's session date. Not a MarketDataSource capability; read by the engine strategy source (src/server/strategies).
   */
  async engineStrategies() {
    const { data, meta } = await this.get("/v1/strategies", strategyBoardSchema, TTL_MS.market);
    return this.snapshot(data, meta.dataAsOf);
  }
}
