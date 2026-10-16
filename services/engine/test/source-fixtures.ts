// Local stand-in for the E2/E2b sources, serving the recorded fixtures in test/fixtures/ at the real paths.
// `world.fetch` rewrites the real origins to this server and refuses every other URL, so job and e2e tests never
// touch the network. arjum is entirely fake (no credentials in tests): it serves the shape of fixtures/arjum.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { fixture } from "./support";

export type SourceName = "tradingview" | "yahoo" | "pasardana" | "arjum";
export const ARJUM_TEST_ORIGIN = "https://arjum.example.test";
export const ARJUM_TEST_KEY = "test-arjum-key";

const ORIGINS: Record<SourceName, string> = {
  tradingview: "https://scanner.tradingview.com",
  yahoo: "https://query1.finance.yahoo.com",
  pasardana: "https://pasardana.id",
  arjum: ARJUM_TEST_ORIGIN,
};

export type Hit = { source: SourceName; method: string; path: string; userAgent: string | undefined; apiKey: string | undefined; body: string };

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
  const state: SourceWorld["state"] = { blocked: new Set(), tvPriceFactor: 1, arjumRemaining: 1000 };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url ?? "/", "http://fixture.local");
    const [, prefix, ...rest] = url.pathname.split("/");
    const source = prefix as SourceName;
    const path = `/${rest.join("/")}`;
    hits.push({ source, method: req.method ?? "GET", path: `${path}${url.search}`, userAgent: req.headers["user-agent"], apiKey: req.headers["x-api-key"] as string | undefined, body });

    if (state.blocked.has(source)) {
      if (source === "arjum") return send(res, 429, '{"detail":"rate limited"}', { "retry-after": "3600" });
      return send(res, 403, "<html><body>Request blocked.</body></html>", { "content-type": "text/html", "x-cache": "Error from cloudfront" });
    }
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
    if (source === "arjum" && path.startsWith("/api/history/")) {
      if (req.headers["x-api-key"] !== ARJUM_TEST_KEY) return send(res, 401, '{"detail":"invalid key"}');
      const code = path.slice("/api/history/".length);
      state.arjumRemaining -= 1;
      const quota = { "x-ratelimit-limit": "1000", "x-ratelimit-remaining": String(state.arjumRemaining) };
      if (code === "ABBA") return send(res, 404, '{"detail":"not found"}', quota);
      // Same rows for every code (the fake BBCA history), re-labelled with the requested code.
      return send(res, 200, fixture("arjum-history-BBCA.fake.json").replace('"stock_code": "BBCA"', `"stock_code": "${code}"`), quota);
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
