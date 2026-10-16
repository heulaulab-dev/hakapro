import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeClock, tempDir } from "../../test/support";
import { documentKey, ENGINE_USER_AGENT, FetchError, Fetcher, SourceBlockedError } from "./fetcher";
import { LimiterRegistry } from "./rate-limit";
import { LocalRawStore } from "./raw-store";
import { MemoryRawDocumentIndex, MemorySourceStateStore } from "./stores";

const SOURCE = { id: "fixture", policy: { minIntervalMs: 2000, concurrency: 2 } };
const URL_ = "https://data.example.test/daily.csv";

type Handler = (request: Request) => Response | Promise<Response>;

function setup(dir: string, handlers: Handler[]) {
  const clock = fakeClock(Date.parse("2026-10-14T10:00:00Z"));
  const requests: Request[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const request = new Request(input instanceof Request ? input.url : String(input), init);
    requests.push(request);
    const handler = handlers.shift();
    if (!handler) throw new Error("unexpected request");
    return handler(request);
  }) as typeof fetch;
  const documents = new MemoryRawDocumentIndex();
  const sourceState = new MemorySourceStateStore();
  const rawStore = new LocalRawStore(dir);
  const fetcher = new Fetcher({ rawStore, documents, sourceState, clock, fetch: fetchImpl, limiters: new LimiterRegistry(clock) });
  return { fetcher, requests, documents, sourceState, rawStore, clock, handlers };
}

const csv = (body: string, headers: Record<string, string> = {}) => () => new Response(body, { status: 200, headers: { "content-type": "text/csv", ...headers } });

describe("Fetcher", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => { dir = await tempDir(); });
  afterEach(async () => { await dir.cleanup(); });

  it("stores a new document with an honest UA and a raw copy", async () => {
    const t = setup(dir.path, [csv("a,b\n1,2\n", { etag: '"v1"' })]);
    const result = await t.fetcher.fetch(SOURCE, URL_);
    expect(result.kind).toBe("new");
    expect(t.requests[0].headers.get("user-agent")).toBe(ENGINE_USER_AGENT);
    expect(ENGINE_USER_AGENT).toBe("HAKAPRO-DataEngine/0.1 (+https://hakapro.heulaulab.xyz)");
    expect(result.document.r2Key).toMatch(/^fixture\/2026-10-14\/[0-9a-f]{64}\.csv$/);
    expect(new TextDecoder().decode((await t.rawStore.get(result.document.r2Key))!)).toBe("a,b\n1,2\n");
    expect(t.documents.docs).toHaveLength(1);
  });

  it("sends conditional headers and reuses the raw copy on 304", async () => {
    const t = setup(dir.path, [csv("x\n", { etag: '"v1"', "last-modified": "Wed, 14 Oct 2026 09:00:00 GMT" }), () => new Response(null, { status: 304 })]);
    await t.fetcher.fetch(SOURCE, URL_);
    const second = await t.fetcher.fetch(SOURCE, URL_);
    expect(t.requests[1].headers.get("if-none-match")).toBe('"v1"');
    expect(t.requests[1].headers.get("if-modified-since")).toBe("Wed, 14 Oct 2026 09:00:00 GMT");
    expect(second.kind).toBe("not_modified");
    expect(await second.text()).toBe("x\n");
    expect(t.documents.docs).toHaveLength(1);
  });

  it("dedupes identical bytes by URL + sha256 and stores changed bytes", async () => {
    const t = setup(dir.path, [csv("same\n"), csv("same\n"), csv("changed\n")]);
    expect((await t.fetcher.fetch(SOURCE, URL_)).kind).toBe("new");
    expect((await t.fetcher.fetch(SOURCE, URL_)).kind).toBe("duplicate");
    expect((await t.fetcher.fetch(SOURCE, URL_)).kind).toBe("new");
    expect(t.documents.docs).toHaveLength(2);
  });

  it("rate-limits requests to the same host", async () => {
    const t = setup(dir.path, [csv("1"), csv("2")]);
    await t.fetcher.fetch(SOURCE, URL_);
    await t.fetcher.fetch(SOURCE, `${URL_}?d=2`);
    expect(t.clock.sleeps).toContain(2000);
  });

  it("stops on a Cloudflare challenge: marks the source blocked, records evidence, never retries", async () => {
    const challenge = `<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={}</script></body></html>`;
    const t = setup(dir.path, [() => new Response(challenge, { status: 403, headers: { "content-type": "text/html", "cf-ray": "abc-SIN", "set-cookie": "__cf_bm=x" } })]);
    const error = await t.fetcher.fetch(SOURCE, URL_).catch((caught) => caught);
    expect(error).toBeInstanceOf(SourceBlockedError);
    expect(t.requests).toHaveLength(1);
    const evidence = t.sourceState.state.get("fixture")!.blocked!;
    expect(evidence.reason).toBe("CLOUDFLARE_CHALLENGE");
    expect(evidence.headers).toEqual({ "cf-ray": "abc-SIN", "content-type": "text/html" });
    // Later calls fail fast without touching the network.
    await expect(t.fetcher.fetch(SOURCE, URL_)).rejects.toBeInstanceOf(SourceBlockedError);
    expect(t.requests).toHaveLength(1);
    expect(t.clock.sleeps).toEqual([]);
  });

  it("treats 429 as a block, not a retry", async () => {
    const t = setup(dir.path, [() => new Response("slow down", { status: 429, headers: { "retry-after": "30" } })]);
    await expect(t.fetcher.fetch(SOURCE, URL_)).rejects.toBeInstanceOf(SourceBlockedError);
    expect(t.requests).toHaveLength(1);
  });

  it("blocks on a redirect to a login page", async () => {
    const t = setup(dir.path, [() => new Response(null, { status: 302, headers: { location: "/login?next=/daily.csv" } })]);
    await expect(t.fetcher.fetch(SOURCE, URL_)).rejects.toBeInstanceOf(SourceBlockedError);
    expect(t.sourceState.state.get("fixture")!.blocked!.reason).toBe("LOGIN_REQUIRED");
  });

  it("follows ordinary redirects", async () => {
    const t = setup(dir.path, [() => new Response(null, { status: 301, headers: { location: "/v2/daily.csv" } }), csv("ok")]);
    expect((await t.fetcher.fetch(SOURCE, URL_)).kind).toBe("new");
    expect(t.requests[1].url).toBe("https://data.example.test/v2/daily.csv");
  });

  it("retries 5xx and network errors with exponential backoff", async () => {
    const t = setup(dir.path, [
      () => new Response("down", { status: 502 }),
      () => { throw new TypeError("fetch failed"); },
      csv("ok"),
    ]);
    expect((await t.fetcher.fetch(SOURCE, URL_)).kind).toBe("new");
    expect(t.requests).toHaveLength(3);
    expect(t.clock.sleeps.filter((ms) => ms === 2000 || ms === 4000)).toEqual(expect.arrayContaining([2000, 4000]));
  });

  it("gives up after 4 attempts and records the error", async () => {
    const t = setup(dir.path, Array.from({ length: 4 }, () => () => new Response("down", { status: 503 })));
    const error = await t.fetcher.fetch(SOURCE, URL_).catch((caught) => caught);
    expect(error).toBeInstanceOf(FetchError);
    expect(t.requests).toHaveLength(4);
    expect(t.sourceState.state.get("fixture")!.lastError).toBe("HTTP 503");
    expect(t.sourceState.state.get("fixture")!.blocked).toBeNull();
  });

  it("blocks (without retrying) on a challenge served as 503", async () => {
    const t = setup(dir.path, [() => new Response("<title>Just a moment...</title>", { status: 503, headers: { "content-type": "text/html" } })]);
    await expect(t.fetcher.fetch(SOURCE, URL_)).rejects.toBeInstanceOf(SourceBlockedError);
    expect(t.requests).toHaveLength(1);
  });

  it("POSTs a JSON body, never conditionally, and keys the document by URL + body hash", async () => {
    const json = (body: string) => () => new Response(body, { status: 200, headers: { "content-type": "application/json", etag: '"v1"' } });
    const t = setup(dir.path, [json('{"a":1}'), json('{"b":2}'), json('{"a":1}')]);
    const scan = "https://scanner.example.test/indonesia/scan";
    const first = await t.fetcher.fetch(SOURCE, scan, { method: "POST", body: '{"q":1}', headers: { "content-type": "application/json" } });
    const second = await t.fetcher.fetch(SOURCE, scan, { method: "POST", body: '{"q":2}', headers: { "content-type": "application/json" } });
    const again = await t.fetcher.fetch(SOURCE, scan, { method: "POST", body: '{"q":1}', headers: { "content-type": "application/json" } });
    expect(t.requests.map((request) => request.method)).toEqual(["POST", "POST", "POST"]);
    expect(await t.requests[0].text()).toBe('{"q":1}');
    expect(t.requests[2].headers.get("if-none-match")).toBeNull();
    expect(t.requests[0].headers.get("user-agent")).toBe(ENGINE_USER_AGENT);
    expect(first.document.url).toBe(documentKey(scan, { method: "POST", body: '{"q":1}' }));
    expect(first.document.url).toMatch(/^https:\/\/scanner\.example\.test\/indonesia\/scan#post-[0-9a-f]{16}$/);
    expect(second.document.url).not.toBe(first.document.url);
    expect([first.kind, second.kind, again.kind]).toEqual(["new", "new", "duplicate"]);
    expect(first.headers.get("etag")).toBe('"v1"');
  });

  it("sends a credential header without storing it, and refuses identity or cookie overrides", async () => {
    const t = setup(dir.path, [() => new Response("{}", { status: 200, headers: { "content-type": "application/json", "x-ratelimit-remaining": "512" } })]);
    const result = await t.fetcher.fetch(SOURCE, URL_, { headers: { "x-api-key": "k-123" } });
    expect(t.requests[0].headers.get("x-api-key")).toBe("k-123");
    expect(result.headers.get("x-ratelimit-remaining")).toBe("512");
    expect(JSON.stringify(t.documents.docs)).not.toContain("k-123");
    for (const name of ["User-Agent", "cookie", "If-None-Match", "x-forwarded-for"]) {
      await expect(t.fetcher.fetch(SOURCE, URL_, { headers: { [name]: "x" } })).rejects.toBeInstanceOf(FetchError);
    }
    expect(t.requests).toHaveLength(1);
  });

  it("never follows a redirect with a credential header or a POST", async () => {
    const t = setup(dir.path, [
      () => new Response(null, { status: 302, headers: { location: "https://elsewhere.example.test/" } }),
      () => new Response(null, { status: 307, headers: { location: "/other" } }),
    ]);
    await expect(t.fetcher.fetch(SOURCE, URL_, { headers: { "x-api-key": "k" } })).rejects.toBeInstanceOf(FetchError);
    await expect(t.fetcher.fetch(SOURCE, URL_, { method: "POST", body: "{}" })).rejects.toBeInstanceOf(FetchError);
    expect(t.requests).toHaveLength(2);
  });

  it("does not retry other 4xx", async () => {
    const t = setup(dir.path, [() => new Response("nope", { status: 404 })]);
    const error = await t.fetcher.fetch(SOURCE, URL_).catch((caught) => caught);
    expect(error).toBeInstanceOf(FetchError);
    expect((error as FetchError).retryable).toBe(false);
    expect(t.requests).toHaveLength(1);
  });
});
