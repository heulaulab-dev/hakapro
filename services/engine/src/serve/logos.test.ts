import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeClock, tempDir } from "../../test/support";
import { Fetcher } from "../fetch/fetcher";
import { LimiterRegistry } from "../fetch/rate-limit";
import { LocalRawStore } from "../fetch/raw-store";
import { MemoryRawDocumentIndex, MemorySourceStateStore } from "../fetch/stores";
import { logoUrl, MAX_LOGO_BYTES, sanitizeSvg, tradingviewLogoSource, TRADINGVIEW_LOGO_HOST } from "../sources/tradingview-logos";
import { LogoService } from "./logos";

const enc = (text: string) => new TextEncoder().encode(text);
// The shape of TradingView's real logos (bank-central-asia.svg, trimmed).
const BCA = '<!-- by TradingView --><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><path fill="#0D63B6" d="M0 0h18v18H0z"/><path fill="url(#a)" d="M4 4h10v10H4z"/><defs><linearGradient id="a"><stop stop-color="#fff"/></linearGradient></defs></svg>';
const SVG = "image/svg+xml";

describe("sanitizeSvg", () => {
  it("accepts a plain vector logo served as image/svg+xml", () => {
    expect(sanitizeSvg(enc(BCA), SVG)).toEqual({ ok: true, svg: BCA });
    expect(sanitizeSvg(enc(BCA), "image/svg+xml; charset=utf-8").ok).toBe(true);
  });

  it("rejects the wrong content type, an empty or oversized body, non-UTF-8 and non-SVG", () => {
    expect(sanitizeSvg(enc(BCA), "application/xml")).toEqual({ ok: false, reason: "content-type" });
    expect(sanitizeSvg(enc(BCA), "text/html")).toEqual({ ok: false, reason: "content-type" });
    expect(sanitizeSvg(enc(BCA), null)).toEqual({ ok: false, reason: "content-type" });
    expect(sanitizeSvg(new Uint8Array(), SVG)).toEqual({ ok: false, reason: "size" });
    expect(sanitizeSvg(enc(BCA.replace("</svg>", `<!--${"x".repeat(MAX_LOGO_BYTES)}--></svg>`)), SVG)).toEqual({ ok: false, reason: "size" });
    expect(sanitizeSvg(new Uint8Array([0x3c, 0x73, 0x76, 0x67, 0x20, 0xff, 0x3e]), SVG)).toEqual({ ok: false, reason: "encoding" });
    expect(sanitizeSvg(enc('<?xml version="1.0"?><Error><Code>AccessDenied</Code></Error>'), SVG)).toEqual({ ok: false, reason: "not svg" });
  });

  it.each([
    ["script", '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
    ["script (case, spacing)", '<svg><SCRIPT >alert(1)</SCRIPT></svg>'],
    ["event handler", '<svg onload="alert(1)"><path d="M0 0"/></svg>'],
    ["event handler after a quote", '<svg><path d="M0 0"onclick="x()"/></svg>'],
    ["javascript: URL", '<svg><a href="javascript:alert(1)"><path/></a></svg>'],
    ["external href", '<svg><use href="https://evil.test/x.svg#a"/></svg>'],
    ["external xlink:href", '<svg><use xlink:href="//evil.test/a"/></svg>'],
    ["external url()", '<svg><path fill="url(https://evil.test/a)"/></svg>'],
    ["foreignObject", '<svg><foreignObject><div>x</div></foreignObject></svg>'],
    ["embedded image", '<svg><image href="#a"/></svg>'],
    ["entity", '<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>'],
    ["data URL", '<svg><a href="#a" style="background:url(#a)"/><set to="data:text/html,x"/></svg>'],
    ["@import", "<svg><style>@import 'x.css';</style></svg>"],
  ])("rejects %s", (_, svg) => {
    expect(sanitizeSvg(enc(svg), SVG).ok).toBe(false);
  });

  it("builds CDN URLs only from well-formed logo ids", () => {
    expect(logoUrl("bank-central-asia")).toBe(`https://${TRADINGVIEW_LOGO_HOST}/bank-central-asia.svg`);
    expect(() => logoUrl("../x")).toThrow();
    expect(() => logoUrl("Bank")).toThrow();
  });
});

describe("LogoService", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => { dir = await tempDir(); });
  afterEach(async () => { await dir.cleanup(); });

  function setup(respond: (url: string) => Response, ids: Record<string, string | null> = { BBCA: "bank-central-asia" }, options: { maxEntries?: number } = {}) {
    const clock = fakeClock(Date.parse("2026-10-28T03:00:00Z"));
    const requests: string[] = [];
    const lookups: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);
      return respond(url);
    }) as typeof fetch;
    const sourceState = new MemorySourceStateStore(() => new Date(clock.now()));
    const fetcher = new Fetcher({
      rawStore: new LocalRawStore(dir.path), documents: new MemoryRawDocumentIndex(), sourceState, clock, fetch: fetchImpl,
      limiters: new LimiterRegistry(clock), maxAttempts: 1, maxBytes: MAX_LOGO_BYTES,
    });
    const service = new LogoService({
      lookup: async (symbol) => { lookups.push(symbol); return ids[symbol] ?? null; },
      fetcher, source: tradingviewLogoSource(), now: () => clock.now(), ...options,
    });
    return { service, requests, lookups, clock, sourceState };
  }

  const svg = (body = BCA, type = SVG) => () => new Response(body, { status: 200, headers: { "content-type": type } });

  it("fetches the logo from the CDN once, then serves it from memory", async () => {
    const t = setup(svg());
    expect(await t.service.get("BBCA")).toEqual({ svg: BCA, logoId: "bank-central-asia" });
    expect(await t.service.get("BBCA")).toEqual({ svg: BCA, logoId: "bank-central-asia" });
    expect(t.requests).toEqual([`https://${TRADINGVIEW_LOGO_HOST}/bank-central-asia.svg`]);
    expect(t.lookups).toEqual(["BBCA"]);
  });

  it("coalesces concurrent requests for one symbol", async () => {
    const t = setup(svg());
    const [a, b] = await Promise.all([t.service.get("BBCA"), t.service.get("BBCA")]);
    expect(a).toEqual(b);
    expect(t.requests).toHaveLength(1);
  });

  it("answers null without a request when the symbol has no logo id, and caches the miss", async () => {
    const t = setup(svg(), { GOTO: null });
    expect(await t.service.get("GOTO")).toBeNull();
    expect(await t.service.get("GOTO")).toBeNull();
    expect(t.requests).toEqual([]);
    expect(t.lookups).toEqual(["GOTO"]);
  });

  it("treats an unsafe or non-SVG body as no logo", async () => {
    expect(await setup(svg('<svg onload="x()"></svg>')).service.get("BBCA")).toBeNull();
    expect(await setup(svg(BCA, "text/html")).service.get("BBCA")).toBeNull();
  });

  it("turns an upstream error or a block into a short-lived miss, never an exception", async () => {
    const t = setup(() => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403, headers: { "content-type": "application/xml" } }));
    expect(await t.service.get("BBCA")).toBeNull();
    // The fetcher's block rules apply unchanged: the source is now blocked and later lookups do not reach the CDN.
    expect(await t.sourceState.isBlocked("tradingview-logos")).toBe(true);
    t.clock.advance(11 * 60_000);
    expect(await t.service.get("BBCA")).toBeNull();
    expect(t.requests).toHaveLength(1);
  });

  it("expires entries and evicts the least recently used past the bound", async () => {
    const t = setup(svg(), { BBCA: "bank-central-asia", BBRI: "bank-rakyat-indonesia", BMRI: "bank-mandiri" }, { maxEntries: 2 });
    await t.service.get("BBCA");
    await t.service.get("BBRI");
    await t.service.get("BBCA"); // BBRI is now the least recently used
    await t.service.get("BMRI");
    expect(t.service.size).toBe(2);
    await t.service.get("BBCA");
    expect(t.requests).toHaveLength(3);
    await t.service.get("BBRI");
    expect(t.requests).toHaveLength(4);
    t.clock.advance(25 * 3_600_000);
    await t.service.get("BBRI");
    expect(t.lookups.filter((symbol) => symbol === "BBRI")).toHaveLength(3);
  });
});
