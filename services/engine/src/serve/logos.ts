// Ticker logos for /v1/logos/{symbol} (HAKA-74): securities.logo_id → TradingView logo CDN through the polite fetcher
// (per-host limit, block detection, raw copy, conditional GET), sanitized, then held in a bounded in-memory LRU.
// Misses (no logo id, a rejected file, an upstream error or a blocked source) are cached too, for a shorter time,
// so a page full of logo-less tickers does not turn into a request per render.
import { FetchError, SourceBlockedError, type FetchOptions, type FetchResult } from "../fetch/fetcher";
import type { HostPolicy } from "../fetch/rate-limit";
import type { Logger } from "../log";
import { nullLogger } from "../log";
import { isLogoId } from "../sources/tradingview";
import { logoUrl, sanitizeSvg } from "../sources/tradingview-logos";

export type LogoFetcher = { fetch(source: { id: string; policy?: HostPolicy }, url: string, options?: FetchOptions): Promise<FetchResult> };

export type LogoServiceOptions = {
  /** Stored logo id of a symbol (null when unknown). */
  lookup(symbol: string): Promise<string | null>;
  fetcher: LogoFetcher;
  source: { id: string; policy: HostPolicy };
  log?: Logger;
  now?: () => number;
  maxEntries?: number;
  hitTtlMs?: number;
  missTtlMs?: number;
  /** Shorter rest after an upstream error or a block, so a lifted block is picked up soon. */
  errorTtlMs?: number;
};

export type Logo = { svg: string; logoId: string };

type Entry = { logo: Logo | null; expires: number };

export const LOGO_CACHE_MAX_ENTRIES = 1200;
const HOUR_MS = 3_600_000;

export class LogoService {
  private readonly cache = new Map<string, Entry>();
  private readonly inflight = new Map<string, Promise<Logo | null>>();
  private readonly log: Logger;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly hitTtlMs: number;
  private readonly missTtlMs: number;
  private readonly errorTtlMs: number;

  constructor(private readonly options: LogoServiceOptions) {
    this.log = options.log ?? nullLogger;
    this.now = options.now ?? Date.now;
    this.maxEntries = Math.max(1, options.maxEntries ?? LOGO_CACHE_MAX_ENTRIES);
    this.hitTtlMs = options.hitTtlMs ?? 24 * HOUR_MS;
    this.missTtlMs = options.missTtlMs ?? 6 * HOUR_MS;
    this.errorTtlMs = options.errorTtlMs ?? 10 * 60_000;
  }

  get size(): number {
    return this.cache.size;
  }

  /** The sanitized SVG for a symbol, or null when it has none that may be served. */
  async get(symbol: string): Promise<Logo | null> {
    const cached = this.cache.get(symbol);
    if (cached && cached.expires > this.now()) {
      // Refresh recency (Map keeps insertion order; the first key is the least recently used).
      this.cache.delete(symbol);
      this.cache.set(symbol, cached);
      return cached.logo;
    }
    if (cached) this.cache.delete(symbol);
    const pending = this.inflight.get(symbol);
    if (pending) return pending;
    const work = this.load(symbol).finally(() => this.inflight.delete(symbol));
    this.inflight.set(symbol, work);
    return work;
  }

  private async load(symbol: string): Promise<Logo | null> {
    const logoId = await this.options.lookup(symbol);
    if (!logoId || !isLogoId(logoId)) return this.remember(symbol, null, this.missTtlMs);
    try {
      const result = await this.options.fetcher.fetch(this.options.source, logoUrl(logoId), { accept: "image/svg+xml" });
      const checked = sanitizeSvg(await result.body(), result.document.contentType);
      if (!checked.ok) {
        this.log.warn("logo_rejected", { symbol, logoId, reason: checked.reason });
        return this.remember(symbol, null, this.missTtlMs);
      }
      return this.remember(symbol, { svg: checked.svg, logoId }, this.hitTtlMs);
    } catch (error) {
      if (error instanceof SourceBlockedError || error instanceof FetchError) {
        this.log.warn("logo_fetch_failed", { symbol, logoId, message: error.message });
        return this.remember(symbol, null, this.errorTtlMs);
      }
      throw error;
    }
  }

  private remember(symbol: string, logo: Logo | null, ttlMs: number): Logo | null {
    this.cache.set(symbol, { logo, expires: this.now() + ttlMs });
    while (this.cache.size > this.maxEntries) this.cache.delete(this.cache.keys().next().value!);
    return logo;
  }
}
