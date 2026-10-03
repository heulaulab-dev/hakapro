import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { recordFixtures } from "../../scripts/record-fixtures";
import { PROVIDER_USER_AGENT } from "../../src/server/config/provider-identity";
import { fixture } from "../support/fixtures";

const KEY = "sk_test_recorder_key_123";
const BASE = "https://provider.example.test";

/** Fake provider answering from the baseline, retargeting per-symbol bodies to the requested symbol. */
function fakeProvider(overrides: Record<string, () => Response> = {}) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: url.toString(), headers: init?.headers as Record<string, string> });
    if (overrides[url.pathname]) return overrides[url.pathname]();
    const symbolMatch = /^\/api\/([a-z-]+)\/([A-Z0-9]+)$/.exec(url.pathname);
    const as = (name: string, symbol: string, key: "stock_code" | "code") => Response.json({ ...fixture<Record<string, unknown>>(name), [key]: symbol, leaked_token: KEY, note: `${BASE}/x` });
    if (url.pathname === "/api/screener/latest") return Response.json(fixture("screener"));
    if (url.pathname === "/api/market-cap") return Response.json(fixture("market-cap"));
    if (url.pathname === "/api/health") return Response.json(fixture("health"));
    if (url.pathname === "/api/search") return Response.json(fixture("search"));
    if (url.pathname === "/api/done-details") return as("done-details", url.searchParams.get("code")!, "code");
    if (symbolMatch) {
      const [, endpoint, symbol] = symbolMatch;
      if (endpoint === "broker-accumulation") return as(endpoint, symbol, "code");
      if (endpoint === "seasonal") return as("seasonal", symbol, "stock_code");
      return as(endpoint, symbol, "stock_code");
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  return { fetcher, calls };
}

const run = (rootDir: string, fetcher: typeof fetch, lines: string[] = []) =>
  recordFixtures({ baseUrl: BASE, apiKey: KEY, rootDir, fetcher, delayMs: 0, log: (line) => lines.push(line), now: () => new Date("2026-10-03T03:00:00Z") });

describe("recordFixtures (fake provider, no network)", () => {
  test("records the screener, every matched symbol plus BBCA, across all per-stock endpoints", async () => {
    const root = mkdtempSync(join(tmpdir(), "hakapro-record-"));
    const { fetcher } = fakeProvider();
    const result = await run(root, fetcher);
    expect(result.ok).toBe(true);
    expect(result.manifest!.symbols).toEqual(["SOCI", "HRTA", "BBCA"]);
    expect(result.manifest!.screenerDate).toBe("2026-09-18");
    for (const symbol of ["SOCI", "HRTA", "BBCA"]) {
      const files = readdirSync(join(root, "fixtures/arjum/symbols", symbol)).sort();
      expect(files).toEqual([
        "broker-accumulation.json", "broker-summary.json", "done-details.json",
        "financial-statements.BALANCE_SHEET.json", "financial-statements.CASH_FLOW_REPORT.json", "financial-statements.INCOME_STATEMENT.json",
        "history.json", "insiders.json", "seasonal.json",
      ]);
    }
    expect(existsSync(join(root, "fixtures/arjum/global/screener.json"))).toBe(true);
    expect(existsSync(join(root, "fixtures/arjum/search/SOCI.json"))).toBe(true);
    // No staging or previous directories left behind.
    expect(readdirSync(join(root, "fixtures")).sort()).toEqual(["arjum"]);
  });

  test("writes no secrets, provider host, injected token keys or order numbers", async () => {
    const root = mkdtempSync(join(tmpdir(), "hakapro-record-"));
    const lines: string[] = [];
    await run(root, fakeProvider().fetcher, lines);
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
    const everything = walk(join(root, "fixtures/arjum")).map((file) => readFileSync(file, "utf8")).join("\n");
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain("provider.example.test");
    expect(everything).not.toContain("leaked_token");
    expect(everything).not.toMatch(/"(buy|sell)_order_number": "(?!REDACTED)/);
    // Logs show API paths only.
    expect(lines.join("\n")).not.toContain(KEY);
    expect(lines.join("\n")).not.toContain("provider.example.test");
  });

  test("sends the key only as the x-api-key header", async () => {
    const { fetcher, calls } = fakeProvider();
    await run(mkdtempSync(join(tmpdir(), "hakapro-record-")), fetcher);
    expect(calls.every((call) => call.headers["x-api-key"] === KEY && !call.url.includes(KEY))).toBe(true);
  });

  test("identifies itself with the honest HAKAPRO user agent", async () => {
    const { fetcher, calls } = fakeProvider();
    await run(mkdtempSync(join(tmpdir(), "hakapro-record-")), fetcher);
    expect(calls.every((call) => call.headers["user-agent"] === PROVIDER_USER_AGENT && /^HAKAPRO\//.test(call.headers["user-agent"]))).toBe(true);
  });

  test("a 429 stops the run at once: no retry, nothing written, previous dataset kept", async () => {
    const root = mkdtempSync(join(tmpdir(), "hakapro-record-"));
    mkdirSync(join(root, "fixtures/arjum"), { recursive: true });
    writeFileSync(join(root, "fixtures/arjum/manifest.json"), "previous");
    const lines: string[] = [];
    const { fetcher, calls } = fakeProvider({ "/api/history/HRTA": () => new Response("{}", { status: 429 }) });
    const result = await run(root, fetcher, lines);
    expect(result.ok).toBe(false);
    expect(calls.filter((call) => call.url.includes("/api/history/HRTA"))).toHaveLength(1);
    expect(calls.at(-1)!.url).toContain("/api/history/HRTA");
    expect(readFileSync(join(root, "fixtures/arjum/manifest.json"), "utf8")).toBe("previous");
    expect(lines.at(-1)).toMatch(/429/);
  });

  test("per-request failures are listed in the manifest and the run continues", async () => {
    const root = mkdtempSync(join(tmpdir(), "hakapro-record-"));
    const result = await run(root, fakeProvider({ "/api/insiders/SOCI": () => new Response("{}", { status: 500 }) }).fetcher);
    expect(result.ok).toBe(true);
    expect(result.manifest!.failures).toEqual([{ endpoint: "insiders", symbol: "SOCI", status: 500 }]);
    expect(existsSync(join(root, "fixtures/arjum/symbols/SOCI/insiders.json"))).toBe(false);
  });

  test("a schema mismatch is refused, not written", async () => {
    const root = mkdtempSync(join(tmpdir(), "hakapro-record-"));
    const result = await run(root, fakeProvider({ "/api/history/HRTA": () => Response.json({ stock_code: "HRTA", frame: "daily", rows: [{ close: "bad" }] }) }).fetcher);
    expect(result.manifest!.failures).toContainEqual({ endpoint: "history", symbol: "HRTA", status: "SCHEMA_MISMATCH" });
    expect(existsSync(join(root, "fixtures/arjum/symbols/HRTA/history.json"))).toBe(false);
  });

  test("screener failure writes nothing and keeps the previous dataset", async () => {
    const root = mkdtempSync(join(tmpdir(), "hakapro-record-"));
    mkdirSync(join(root, "fixtures/arjum"), { recursive: true });
    writeFileSync(join(root, "fixtures/arjum/manifest.json"), "previous");
    const result = await run(root, fakeProvider({ "/api/screener/latest": () => new Response("{}", { status: 503 }) }).fetcher);
    expect(result.ok).toBe(false);
    expect(readFileSync(join(root, "fixtures/arjum/manifest.json"), "utf8")).toBe("previous");
    expect(readdirSync(join(root, "fixtures"))).toEqual(["arjum"]);
  });
});
