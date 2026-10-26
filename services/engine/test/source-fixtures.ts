// Local stand-in for the E2/E2b/E3 sources, serving the recorded fixtures in test/fixtures/ at the real paths.
// `world.fetch` rewrites the real origins to this server and refuses every other URL, so job and e2e tests never
// touch the network. arjum is entirely fake (no credentials in tests): it serves the shape of fixtures/arjum.
// The news feeds answer conditional requests like the real hosts: CNBC by ETag, Antara by Last-Modified.
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fixture } from "./support";

export type SourceName = "tradingview" | "yahoo" | "pasardana" | "arjum" | "cnbc" | "detik" | "antara" | "investortrust" | "bi";
export const ARJUM_TEST_ORIGIN = "https://arjum.example.test";
export const ARJUM_TEST_KEY = "test-arjum-key";

const ORIGINS: Record<SourceName, string> = {
  tradingview: "https://scanner.tradingview.com",
  yahoo: "https://query1.finance.yahoo.com",
  pasardana: "https://pasardana.id",
  arjum: ARJUM_TEST_ORIGIN,
  cnbc: "https://www.cnbcindonesia.com",
  detik: "https://finance.detik.com",
  antara: "https://www.antaranews.com",
  investortrust: "https://investortrust.id",
  bi: "https://www.bi.go.id",
};

const FEEDS: Record<string, string> = {
  "cnbc /market/rss": "news-cnbcindonesia-market.xml",
  "detik /rss": "news-detik-finance.xml",
  "antara /rss/ekonomi-bursa.xml": "news-antara-bursa.xml",
  "investortrust /rss/market.rss": "news-investortrust-market.xml",
  "investortrust /rss/macro.rss": "news-investortrust-macro.xml",
};
const BI_PAGES: Record<string, string> = {
  "/id/statistik/indikator/bi-rate.aspx": "bi-rate.html",
  "/id/statistik/informasi-kurs/jisdor/default.aspx": "bi-jisdor.html",
};
const FUNDAMENTALS_PREFIX = "/ws/fundamentals-timeseries/v1/finance/timeseries/";
/** Recorded fundamentals timeseries; every other ticker answers 404 (no fixture). */
const FUNDAMENTALS: Record<string, string> = {
  "BBCA.JK": "yahoo-fundamentals-BBCA.json", "TLKM.JK": "yahoo-fundamentals-TLKM.json", "GOTO.JK": "yahoo-fundamentals-GOTO.json",
};
const ANTARA_LAST_MODIFIED ="Fri, 16 Oct 2026 07:27:02 GMT";
/** Prepended to CNBC's feed when `newsUpdate` is on: one new story and a re-post of an Antara headline. */
const CNBC_UPDATE = `<item>
      <guid>https://www.cnbcindonesia.com/market/20261016150000-17-776900/asing-borong-bbca</guid>
      <pubDate>Fri, 16 Oct 2026 14:20:00 +0700</pubDate>
      <title><![CDATA[Asing Borong $BBCA Saat IHSG Ambruk]]></title>
      <description><![CDATA[<p>Investor asing mencatat beli bersih di BBCA.</p>]]></description>
      <link>https://www.cnbcindonesia.com/market/20261016150000-17-776900/asing-borong-bbca?utm_source=rss</link>
    </item>
    <item>
      <guid>https://www.cnbcindonesia.com/market/20261016150500-17-776901/repost</guid>
      <pubDate>Fri, 16 Oct 2026 14:25:00 +0700</pubDate>
      <title><![CDATA[BEI Minta Investor Tetap Rasional dan Lihat Fundamental Bursa RI]]></title>
      <link>https://www.cnbcindonesia.com/market/20261016150500-17-776901/repost</link>
    </item>
    `;

export type Hit = {
  source: SourceName; method: string; path: string; userAgent: string | undefined; apiKey: string | undefined; body: string;
  ifNoneMatch: string | undefined; ifModifiedSince: string | undefined;
};

export type SourceWorld = {
  origin: string;
  hits: Hit[];
  state: {
    /** Sources answering with a block (TradingView/Pasardana/Yahoo: 403; arjum: 429). */
    blocked: Set<SourceName>;
    /** Multiplies TradingView prices, so a later poll returns different bytes (a new snapshot). */
    tvPriceFactor: number;
    /** x-ratelimit-remaining arjum reports before each call; decremented per call. */
    arjumRemaining: number;
    /** CNBC's feed gains two items (new ETag): a new story naming $BBCA and a re-post of an Antara headline. */
    newsUpdate: boolean;
    /** Yahoo's fundamentals path answers 429 (the host's rate limit); the chart path keeps answering. */
    fundamentalsRateLimited: boolean;
    /** arjum's insider pages gain one newer transaction on top (a new filing since the last read). */
    insidersUpdate: boolean;
  };
  fetch: typeof fetch;
  close(): Promise<void>;
};

const send = (res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(body);
};

function scaledScan(text: string, factor: number): string {
  if (factor === 1) return text;
  const parsed = JSON.parse(text) as { totalCount: number; data: Array<{ s: string; d: unknown[] }> };
  // close, open, high, low sit at indexes 3–6 of the market columns.
  for (const row of parsed.data) for (const i of [3, 4, 5, 6]) if (typeof row.d[i] === "number") row.d[i] = Math.round((row.d[i] as number) * factor);
  return JSON.stringify(parsed);
}

export async function startSourceWorld(): Promise<SourceWorld> {
  const hits: Hit[] = [];
  const state: SourceWorld["state"] = { blocked: new Set(), tvPriceFactor: 1, arjumRemaining: 1000, newsUpdate: false, fundamentalsRateLimited: false, insidersUpdate: false };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://fixture.local");
    const [, prefix, ...rest] = url.pathname.split("/");
    const source = prefix as SourceName;
    const path = `/${rest.join("/")}`;
    hits.push({
      source, method: req.method ?? "GET", path: `${path}${url.search}`, userAgent: req.headers["user-agent"], apiKey: req.headers["x-api-key"] as string | undefined, body,
      ifNoneMatch: req.headers["if-none-match"] as string | undefined, ifModifiedSince: req.headers["if-modified-since"] as string | undefined,
    });

    if (state.blocked.has(source)) {
      if (source === "arjum") return send(res, 429, '{"detail":"rate limited"}', { "retry-after": "3600" });
      // CNBC sits behind Cloudflare: its block is a managed challenge.
      if (source === "cnbc") return send(res, 403, "<html><head><title>Just a moment...</title></head><body></body></html>", { "content-type": "text/html", "cf-mitigated": "challenge", "cf-ray": "fixture-CGK", server: "cloudflare" });
      return send(res, 403, "<html><body>Request blocked.</body></html>", { "content-type": "text/html", "x-cache": "Error from cloudfront" });
    }
    const feed = FEEDS[`${source} ${path}`];
    if (feed && req.method === "GET") {
      let xml = fixture(feed);
      if (source === "cnbc" && state.newsUpdate) xml = xml.replace("<item>", CNBC_UPDATE + "<item>");
      if (source === "cnbc") {
        const etag = `"${createHash("sha256").update(xml).digest("hex").slice(0, 16)}"`;
        if (req.headers["if-none-match"] === etag) { res.writeHead(304, { etag }); res.end(); return; }
        return send(res, 200, xml, { "content-type": "text/xml;charset=UTF-8", etag, server: "cloudflare", "cf-ray": "fixture-CGK" });
      }
      if (source === "antara") {
        if (req.headers["if-modified-since"] === ANTARA_LAST_MODIFIED) { res.writeHead(304, { "last-modified": ANTARA_LAST_MODIFIED }); res.end(); return; }
        return send(res, 200, xml, { "content-type": "text/xml; charset=utf-8", "last-modified": ANTARA_LAST_MODIFIED });
      }
      return send(res, 200, xml, { "content-type": source === "investortrust" ? "application/rss+xml" : "text/xml" });
    }
    if (source === "bi" && BI_PAGES[path] && req.method === "GET") return send(res, 200, fixture(BI_PAGES[path]), { "content-type": "text/html; charset=utf-8" });
    if (source === "tradingview" && req.method === "POST") {
      if (path === "/indonesia/scan") return send(res, 200, scaledScan(fixture("tradingview-indonesia-scan.json"), state.tvPriceFactor));
      if (path === "/global/scan") return send(res, 200, fixture("tradingview-global-indices.json"));
    }
    if (source === "pasardana" && path === "/api/StockSearchResult/GetAll") {
      return send(res, 200, url.searchParams.get("pageBegin") === "1" ? fixture("pasardana-getall.json") : "[]");
    }
    if (source === "yahoo" && path.startsWith("/v8/finance/chart/")) {
      const ticker = decodeURIComponent(path.slice("/v8/finance/chart/".length));
      if (ticker === "^JKSE") return send(res, 200, fixture("yahoo-chart-JKSE-5d.json"));
      if (ticker === "BBCA.JK") return send(res, 200, fixture(url.searchParams.has("period1") ? "yahoo-chart-BBCA-2021-events.json" : "yahoo-chart-BBCA-5d.json"));
      return send(res, 404, JSON.stringify({ chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } }));
    }
    if (source === "yahoo" && path.startsWith(FUNDAMENTALS_PREFIX)) {
      if (state.fundamentalsRateLimited) return send(res, 429, "Too Many Requests", { "content-type": "text/plain", "retry-after": "60" });
      const ticker = decodeURIComponent(path.slice(FUNDAMENTALS_PREFIX.length));
      const recorded = FUNDAMENTALS[ticker];
      if (recorded) return send(res, 200, fixture(recorded), { "cache-control": "public, max-age=60, stale-while-revalidate=30", server: "ATS" });
      return send(res, 404, JSON.stringify({ finance: { result: null, error: { code: "Not Found", description: "Quote not found" } } }));
    }
    if (source === "arjum" && path.startsWith("/api/history/")) {
      if (req.headers["x-api-key"] !== ARJUM_TEST_KEY) return send(res, 401, '{"detail":"invalid key"}');
      const code = path.slice("/api/history/".length);
      state.arjumRemaining -= 1;
      const quota = { "x-ratelimit-limit": "1000", "x-ratelimit-remaining": String(state.arjumRemaining) };
      if (code === "ABBA") return send(res, 404, '{"detail":"not found"}', quota);
      // Same rows for every code (the fake BBCA history), re-labelled with the requested code.
      return send(res, 200, fixture("arjum-history-BBCA.fake.json").replace('"stock_code": "BBCA"', `"stock_code": "${code}"`), quota);
    }
    if (source === "arjum" && path.startsWith("/api/insiders/")) {
      if (req.headers["x-api-key"] !== ARJUM_TEST_KEY) return send(res, 401, '{"detail":"invalid key"}');
      const code = path.slice("/api/insiders/".length);
      state.arjumRemaining -= 1;
      const quota = { "x-ratelimit-limit": "1000", "x-ratelimit-remaining": String(state.arjumRemaining) };
      if (code === "ABBA") return send(res, 404, '{"detail":"not found"}', quota);
      // The same fake page for every code, re-labelled; with `insidersUpdate`, one newer filing on top.
      const page = JSON.parse(fixture("arjum-insiders-BBCA.fake.json")) as { stock_code: string; items: Array<Record<string, unknown>> };
      page.stock_code = code;
      if (state.insidersUpdate) page.items.unshift({ ...page.items[0], name: "BARU CONTOH", date: "2026-10-22", changes_value: "+1,000", current_value: "1,001,000" });
      return send(res, 200, JSON.stringify(page), quota);
    }
    send(res, 404, '{"error":"no fixture"}');
  };

  const server: Server = createServer((req, res) => void handle(req, res).catch(() => send(res, 500, "{}")));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const rewrite = (target: string): string => {
    for (const [name, real] of Object.entries(ORIGINS)) {
      if (target === real || target.startsWith(`${real}/`)) return `${origin}/${name}${target.slice(real.length)}`;
    }
    throw new Error(`Test fetch refused a non-fixture URL: ${target}`);
  };
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const target = input instanceof Request ? input.url : String(input);
    return fetch(rewrite(target), init);
  }) as typeof fetch;

  return { origin, hits, state, fetch: fetchImpl, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
