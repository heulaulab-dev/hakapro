// Polite fetcher (DATA-ENGINE.md §2): honest UA, per-host rate limit, conditional requests, URL+sha256 dedupe,
// raw copy of every new document, block detection. There is deliberately no bypass of any kind: one fixed UA,
// no proxies, no challenge solving, no browser automation, no retry after a block. A 429 only rests the source for
// its cooldown (block.ts), after which the next scheduled run may fetch again.
import { createHash } from "node:crypto";
import { detectBlock, evidenceHeaders, type BlockDetection } from "./block";
import { DEFAULT_HOST_POLICY, LimiterRegistry, realClock, type Clock, type HostPolicy } from "./rate-limit";
import { rawKey, type RawStore } from "./raw-store";
import type { BlockEvidence, RawDocumentIndex, RawDocumentRecord, SourceStateStore } from "./stores";

export const ENGINE_USER_AGENT = "HAKAPRO-DataEngine/0.1 (+https://hakapro.heulaulab.xyz)";

export type FetchSource = { id: string; policy?: HostPolicy };

export type FetchOptions = {
  fetchRunId?: string | null;
  accept?: string;
  /** Skip If-None-Match / If-Modified-Since (e.g. a deliberate re-check). */
  unconditional?: boolean;
  /** POST with a JSON body (e.g. TradingView's scanner). POSTs are never conditional and never follow redirects. */
  method?: "GET" | "POST";
  body?: string;
  /**
   * Extra request headers, for a documented API credential (arjum `x-api-key`) or a content type. Identity, cookie
   * and conditional headers are refused: the fetcher owns them, and they are never changed to get past a block.
   */
  headers?: Record<string, string>;
};

export type FetchResult = {
  /** new: stored now · duplicate: same bytes as a stored copy · not_modified: 304 on the stored validators. */
  kind: "new" | "duplicate" | "not_modified";
  document: RawDocumentRecord;
  /** Response headers of this request (e.g. a provider's x-ratelimit-* quota). */
  headers: Headers;
  body(): Promise<Uint8Array>;
  text(): Promise<string>;
};

const RESERVED_HEADERS = /^(user-agent|cookie|if-none-match|if-modified-since|host|proxy-.*|x-forwarded-.*|forwarded)$/i;

/**
 * Index key of a request in raw_documents. A GET is its URL; a POST adds a fragment with the body hash (never sent
 * to the server), so different scanner queries to one URL are cached and deduplicated separately.
 */
export function documentKey(url: string, options: Pick<FetchOptions, "method" | "body"> = {}): string {
  if ((options.method ?? "GET") === "GET") return url;
  return `${url.split("#")[0]}#post-${createHash("sha256").update(options.body ?? "").digest("hex").slice(0, 16)}`;
}

export class SourceBlockedError extends Error {
  constructor(readonly sourceId: string, readonly evidence: BlockEvidence | null) {
    super(`Source ${sourceId} is blocked${evidence ? ` (${evidence.reason})` : ""}`);
    this.name = "SourceBlockedError";
  }
}

export class FetchError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
    this.name = "FetchError";
  }
}

export type FetcherDeps = {
  rawStore: RawStore;
  documents: RawDocumentIndex;
  sourceState: SourceStateStore;
  limiters?: LimiterRegistry;
  fetch?: typeof fetch;
  clock?: Clock;
  /** Attempts for 5xx/network errors only (default 4: waits 2s, 4s, 8s). */
  maxAttempts?: number;
  backoffBaseMs?: number;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
};

const sha256 = (body: Uint8Array) => createHash("sha256").update(body).digest("hex");
const decoder = new TextDecoder();

export class Fetcher {
  private readonly limiters: LimiterRegistry;
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;
  private readonly maxAttempts: number;
  private readonly backoffBaseMs: number;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRedirects: number;

  constructor(private readonly deps: FetcherDeps) {
    this.clock = deps.clock ?? realClock;
    this.limiters = deps.limiters ?? new LimiterRegistry(this.clock);
    this.fetchImpl = deps.fetch ?? fetch;
    this.maxAttempts = deps.maxAttempts ?? 4;
    this.backoffBaseMs = deps.backoffBaseMs ?? 2000;
    this.timeoutMs = deps.timeoutMs ?? 30_000;
    this.maxBytes = deps.maxBytes ?? 25 * 1024 * 1024;
    this.maxRedirects = deps.maxRedirects ?? 5;
  }

  async fetch(source: FetchSource, url: string, options: FetchOptions = {}): Promise<FetchResult> {
    for (const name of Object.keys(options.headers ?? {})) {
      if (RESERVED_HEADERS.test(name)) throw new FetchError(`Header ${name} is managed by the fetcher`, null, false);
    }
    if (await this.deps.sourceState.isBlocked(source.id)) throw new SourceBlockedError(source.id, null);
    const key = documentKey(url, options);
    const conditional = !options.unconditional && (options.method ?? "GET") === "GET";
    const previous = conditional ? await this.deps.documents.latestForUrl(key) : null;

    let response: Response | null = null;
    let finalUrl = url;
    for (let attempt = 1; ; attempt += 1) {
      try {
        ({ response, finalUrl } = await this.request(source, url, previous, options));
        if (response.status < 500) break;
        // 5xx may still be a challenge page (Cloudflare serves some with 503); that check happens below.
        const body = await this.readBody(response).catch(() => new Uint8Array());
        await this.stopIfBlocked(source, finalUrl, response, body);
        if (attempt >= this.maxAttempts) throw new FetchError(`HTTP ${response.status}`, response.status, true);
      } catch (error) {
        if (error instanceof SourceBlockedError || (error instanceof FetchError && !error.retryable)) throw error;
        if (attempt >= this.maxAttempts) {
          await this.deps.sourceState.recordError(source.id, error instanceof Error ? error.message : "fetch failed");
          throw error instanceof FetchError ? error : new FetchError("Network error", null, true);
        }
      }
      await this.clock.sleep(this.backoffBaseMs * 2 ** (attempt - 1));
    }

    if (!response) throw new FetchError("No response", null, false);
    if (response.status === 304 && previous) {
      return this.result("not_modified", previous, null, response.headers);
    }

    const body = await this.readBody(response);
    await this.stopIfBlocked(source, finalUrl, response, body);
    if (!response.ok) {
      const message = `HTTP ${response.status}`;
      await this.deps.sourceState.recordError(source.id, message);
      throw new FetchError(message, response.status, false);
    }

    const digest = sha256(body);
    const duplicate = await this.deps.documents.findByUrlSha(key, digest);
    if (duplicate) return this.result("duplicate", duplicate, body, response.headers);

    const fetchedAt = new Date(this.clock.now());
    const contentType = response.headers.get("content-type");
    const storeKey = rawKey(source.id, fetchedAt, digest, contentType);
    if (!(await this.deps.rawStore.exists(storeKey))) await this.deps.rawStore.put(storeKey, body, contentType);
    const document = await this.deps.documents.insert({
      source: source.id, url: key, fetchedAt, httpStatus: response.status, sha256: digest, r2Key: storeKey, contentType,
      byteSize: body.byteLength, etag: response.headers.get("etag"), lastModified: response.headers.get("last-modified"),
      fetchRunId: options.fetchRunId ?? null,
    });
    return this.result(document.sha256 === digest && document.fetchedAt.getTime() === fetchedAt.getTime() ? "new" : "duplicate", document, body, response.headers);
  }

  /** One logical request, following up to maxRedirects hops manually so every hop is rate-limited and checked. */
  private async request(source: FetchSource, url: string, previous: RawDocumentRecord | null, options: FetchOptions) {
    let current = url;
    for (let hop = 0; hop <= this.maxRedirects; hop += 1) {
      const target = new URL(current);
      if (target.protocol !== "https:" && target.protocol !== "http:") throw new FetchError("Unsupported URL scheme", null, false);
      const headers: Record<string, string> = { ...options.headers, "user-agent": ENGINE_USER_AGENT, accept: options.accept ?? "*/*" };
      if (hop === 0 && previous) {
        if (previous.etag) headers["if-none-match"] = previous.etag;
        if (previous.lastModified) headers["if-modified-since"] = previous.lastModified;
      }
      const method = options.method ?? "GET";
      const limiter = this.limiters.forHost(target.host, source.policy ?? DEFAULT_HOST_POLICY);
      const response = await limiter.run(() => this.fetchImpl(current, {
        method, headers, body: method === "POST" ? options.body ?? "" : undefined, redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs),
      }));
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && response.status !== 304 && location) {
        await this.stopIfBlocked(source, current, response, new Uint8Array(), location);
        await response.body?.cancel().catch(() => {});
        // A POST is not replayed, and a credential header never follows a redirect to wherever it points.
        if (method === "POST" || options.headers) throw new FetchError(`Unexpected redirect (HTTP ${response.status})`, response.status, false);
        current = new URL(location, current).toString();
        continue;
      }
      return { response, finalUrl: current };
    }
    throw new FetchError("Too many redirects", null, false);
  }

  private async readBody(response: Response): Promise<Uint8Array> {
    const declared = Number(response.headers.get("content-length"));
    if (declared > this.maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new FetchError("Response too large", response.status, false);
    }
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength > this.maxBytes) throw new FetchError("Response too large", response.status, false);
    return body;
  }

  private async stopIfBlocked(source: FetchSource, url: string, response: Response, body: Uint8Array, location?: string | null) {
    const detection: BlockDetection | null = detectBlock({
      status: response.status, headers: response.headers, requestUrl: url, location,
      body: body.byteLength ? decoder.decode(body.subarray(0, 65_536)) : undefined,
    });
    if (!detection) return;
    const evidence: BlockEvidence = {
      reason: detection.reason, url, status: response.status, markers: detection.markers,
      headers: evidenceHeaders(response.headers), detectedAt: new Date(this.clock.now()).toISOString(),
    };
    throw new SourceBlockedError(source.id, await this.deps.sourceState.markBlocked(source.id, evidence));
  }

  private result(kind: FetchResult["kind"], document: RawDocumentRecord, body: Uint8Array | null, headers: Headers): FetchResult {
    const load = async () => {
      if (body) return body;
      const stored = await this.deps.rawStore.get(document.r2Key);
      if (!stored) throw new FetchError(`Raw copy missing for ${document.r2Key}`, null, false);
      return stored;
    };
    return { kind, document, headers, body: load, text: async () => decoder.decode(await load()) };
  }
}
