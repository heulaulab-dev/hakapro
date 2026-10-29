import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { MarketDataError } from "@/server/market/errors";
import { IdxBeiSource } from "@/server/market/idx-bei-source";
import type { MarketDataSource } from "@/server/market/source";
import { ProviderBackoff } from "@/server/providers/backoff";
import { MemoryCursorStore, MemoryRunRecorder, MemorySourceStateStore } from "../../../../../services/engine/src/fetch/stores";
import { createApp } from "../../../../../services/engine/src/http/app";
import { PauseGuard } from "../../../../../services/engine/src/schedule/pause";
import { Scheduler } from "../../../../../services/engine/src/schedule/scheduler";
import type { LogoService } from "../../../../../services/engine/src/serve/logos";

const SVG = '<!-- by TradingView --><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><path fill="#0D63B6" d="M0 0h18v18H0z"/></svg>';

let access: "allow" | "unauthorized" = "allow";
let source: MarketDataSource;
vi.mock("@/server/auth", () => ({ checkAccess: async () => access }));
vi.mock("@/server/market", async (importOriginal) => ({ ...(await importOriginal<object>()), getMarketDataSource: () => source }));

/** The real engine handler (logos on or off) behind the app's IdxBeiSource, with a stubbed logo service. */
function engineSource(dir: string, logos: Record<string, string> | null) {
  const pause = new PauseGuard(dir, 85, { cacheMs: 0, measure: async () => 10 });
  const scheduler = new Scheduler({ jobs: [], pause, runs: new MemoryRunRecorder(), cursors: new MemoryCursorStore(), sourceState: new MemorySourceStateStore() });
  const service = logos ? ({ get: async (symbol: string) => (logos[symbol] ? { svg: logos[symbol], logoId: "x" } : null) } as unknown as LogoService) : null;
  const app = createApp({ ping: async () => true, pause, scheduler, rawStoreKind: "local", sourceHealth: async () => [], unblockSource: async () => false, logos: service });
  const fetcher = ((input: string | URL | Request, init?: RequestInit) => app(new Request(input, init))) as typeof fetch;
  return new IdxBeiSource("http://engine.test", undefined, fetcher, new ProviderBackoff());
}

const call = async (symbol: string) => {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/logos/${symbol}`), { params: Promise.resolve({ symbol }) });
};

describe("GET /api/logos/[symbol]", () => {
  let dir: string;
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "logo-route-")); });
  afterAll(async () => { await rm(dir, { recursive: true, force: true }); });
  beforeEach(() => { access = "allow"; });

  test("serves the engine's SVG from our origin with cache and lockdown headers", async () => {
    source = engineSource(dir, { BBCA: SVG });
    const response = await call("BBCA");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("public, max-age=86400, stale-while-revalidate=604800");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'");
    expect(await response.text()).toBe(SVG);
    // Lowercase input is normalised like every symbol route.
    expect((await call("bbca")).status).toBe(200);
  });

  test("404 when the symbol has no logo, when logos are off on the engine, or on a lane without the engine", async () => {
    source = engineSource(dir, { BBCA: SVG });
    expect((await call("GOTO")).status).toBe(404);
    source = engineSource(dir, null);
    expect((await call("BBCA")).status).toBe(404);
    source = { id: "fixture", logo: async () => { throw new MarketDataError("UNSUPPORTED", "fixture does not provide logo", 503); } } as unknown as MarketDataSource;
    const fixture = await call("BBCA");
    expect(fixture.status).toBe(404);
    expect(await fixture.text()).toBe("");
  });

  test("re-checks what the engine sends: a script-carrying or non-SVG body is never served", async () => {
    source = engineSource(dir, { EVIL: '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>' });
    expect((await call("EVIL")).status).toBe(404);
    const html = new IdxBeiSource("http://engine.test", undefined, (async () => new Response(SVG, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch, new ProviderBackoff());
    source = html;
    expect((await call("BBCA")).status).toBe(404);
  });

  test("invalid symbol → 400; unauthenticated → 401; engine down → 503 (never cached)", async () => {
    source = engineSource(dir, { BBCA: SVG });
    expect((await call("bad$sym")).status).toBe(400);
    access = "unauthorized";
    expect((await call("BBCA")).status).toBe(401);
    access = "allow";
    source = new IdxBeiSource("http://engine.test", undefined, (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch, new ProviderBackoff());
    const down = await call("BBCA");
    expect(down.status).toBe(503);
    expect(down.headers.get("cache-control")).toBe("no-store");
  });
});
