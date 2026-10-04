// Ported from heulatrade lib/market/arjum/client.ts.
import "server-only";
import type { z } from "zod";
import { MarketDataError } from "@/server/market/errors";
import { PROVIDER_USER_AGENT } from "@/server/config/provider-identity";
import { logWarn } from "@/server/log";
import { ProviderBackoff } from "../backoff";
import { buildProviderUrl, type QueryValue } from "./queries";

export type ArjumClientOptions = { baseUrl?: string; apiKey?: string; timeoutMs?: number; fetcher?: typeof fetch; backoff?: ProviderBackoff };

/** Shared by every ArjumClient in this server instance, so one 429 pauses all arjum calls. */
const sharedBackoff = new ProviderBackoff();

export type ProviderQuota = { limit: number; remaining: number; observedAt: string };
let lastQuota: ProviderQuota | null = null;
/** Daily request quota as last reported by the provider (`x-ratelimit-*` headers); read without an extra call. */
export function lastObservedQuota(): ProviderQuota | null {
  return lastQuota;
}
function observeQuota(headers: Headers) {
  const limit = Number(headers.get("x-ratelimit-limit"));
  const remaining = Number(headers.get("x-ratelimit-remaining"));
  if (headers.has("x-ratelimit-limit") && Number.isFinite(limit) && Number.isFinite(remaining)) lastQuota = { limit, remaining, observedAt: new Date().toISOString() };
}

export type RawFetcher = <T extends z.ZodType>(path: string, schema: T, query?: Record<string, QueryValue>, signal?: AbortSignal) => Promise<z.infer<T>>;

export class ArjumClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private readonly backoff: ProviderBackoff;

  constructor(options: ArjumClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? process.env.HEULATRADE_MARKET_API_BASE_URL ?? "";
    this.apiKey = options.apiKey ?? process.env.HEULATRADE_MARKET_API_KEY ?? "";
    this.timeoutMs = options.timeoutMs ?? 12_000;
    this.fetcher = options.fetcher ?? fetch;
    this.backoff = options.backoff ?? sharedBackoff;
    if (!this.baseUrl || !this.apiKey) throw new MarketDataError("NOT_CONFIGURED", "Market provider is not configured", 503);
  }

  get: RawFetcher = async (path, schema, query = {}, signal) => {
    this.backoff.check();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetcher(buildProviderUrl(this.baseUrl, path, query), {
        headers: { "x-api-key": this.apiKey, accept: "application/json", "user-agent": PROVIDER_USER_AGENT },
        signal: combined,
        cache: "no-store",
      });
    } catch {
      throw new MarketDataError("PROVIDER_UNAVAILABLE", "Provider unavailable", 503);
    }
    observeQuota(response.headers);
    if (response.status === 401 || response.status === 403) throw new MarketDataError("PROVIDER_UNAUTHORIZED", "Provider rejected its server credential", 502);
    if (response.status === 429) {
      const seconds = this.backoff.trip(Number(response.headers.get("retry-after")) || undefined);
      logWarn("provider_rate_limited", { path, cooldownSeconds: seconds });
      throw new MarketDataError("RATE_LIMITED", "Provider rate limit reached", 429, seconds);
    }
    // 400/422 mean our request broke a provider rule (e.g. a page-size limit): a bug to fix, not an outage.
    if (response.status === 400 || response.status === 422) {
      logWarn("provider_rejected_request", { path, status: response.status });
      throw new MarketDataError("INVALID_REQUEST", "Provider rejected the request parameters", 400);
    }
    // Documented for unknown stock codes (e.g. /api/price/{code}).
    if (response.status === 404) throw new MarketDataError("NOT_FOUND", "Provider has no data for this request", 404);
    if (!response.ok) throw new MarketDataError("PROVIDER_UNAVAILABLE", `Provider returned ${response.status}`, 503);
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) throw new MarketDataError("MALFORMED_PROVIDER_RESPONSE", "Provider response did not match its contract", 502);
    return parsed.data;
  };
}
