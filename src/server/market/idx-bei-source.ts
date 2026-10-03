import "server-only";
import type { z } from "zod";
import { classifySessionDate, withFreshness, type Freshness, type WithFreshness } from "@/lib/freshness";
import {
  actionsSchema, announcementItemSchema, fundamentalsSchema, idxBeiEnvelope, marketOverviewSchema, newsItemSchema,
  profileSchema, screenRequestSchema, screenResultSchema, securitySchema, signalsSchema, stockSchema, type ScreenRequest,
} from "@/server/schemas/idx-bei";
import { symbolSchema } from "@/server/schemas/inputs";
import { MarketDataError } from "./errors";
import { BaseMarketDataSource, type PageQuery } from "./source";
import type { Candle, Quote } from "./types";
import type { Clock } from "./arjum-source";

const pct = (fraction: number | null) => (fraction === null ? null : fraction * 100);

/** In-memory TTL cache, ported from heulatrade lib/market/providers/direct.ts. */
const TTL_MS = { securities: 3_600_000, profile: 86_400_000, news: 900_000, market: 300_000 } as const;
const cache = new Map<string, { value: unknown; at: number }>();

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
  ) {
    super();
  }

  static fromEnv(): IdxBeiSource {
    const url = process.env.MARKET_API_URL?.replace(/\/$/, "");
    if (!url) throw new MarketDataError("NOT_CONFIGURED", "Market data service is not configured", 503);
    return new IdxBeiSource(url);
  }

  private async get<T extends z.ZodType>(path: string, data: T, ttl?: number, init?: RequestInit) {
    const key = init?.body ? null : path;
    const hit = key && ttl ? cache.get(key) : undefined;
    if (hit && Date.now() - hit.at < ttl!) return hit.value as z.infer<ReturnType<typeof idxBeiEnvelope<T>>>;
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    } catch {
      throw new MarketDataError("PROVIDER_UNAVAILABLE", "Market service could not be reached", 503);
    }
    if (!response.ok) throw new MarketDataError("PROVIDER_UNAVAILABLE", `Market service returned ${response.status}`, response.status === 400 ? 400 : 503);
    const parsed = idxBeiEnvelope(data).safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new MarketDataError("MALFORMED_PROVIDER_RESPONSE", "Market response format changed", 502);
    if (key && ttl) cache.set(key, { value: parsed.data, at: Date.now() });
    return parsed.data;
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
    // app.py returns no as-of for profiles → UNAVAILABLE freshness. TODO(verify) a source date.
    const { data, meta } = await this.get(`/v1/stocks/${encodeURIComponent(symbolSchema.parse(symbol))}/profile`, profileSchema, TTL_MS.profile);
    return this.wrap(data, "HISTORICAL", meta.dataAsOf);
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
    const body = screenRequestSchema.parse(request);
    const { data, meta } = await this.get("/v1/screener", screenResultSchema, undefined, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
    // change1D comes back as a fraction; domain percent fields are percent units.
    return this.snapshot({ ...data, rows: data.rows.map((row) => ({ ...row, change1D: typeof row.change1D === "number" ? row.change1D * 100 : null })) }, meta.dataAsOf);
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
}
