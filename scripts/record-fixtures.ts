#!/usr/bin/env bun
/**
 * Records real arjum responses into fixtures/arjum/ for fixture mode.
 *
 *   bun run record:fixtures            # screener matches (max 25) + BBCA
 *   bun run record:fixtures --limit 10
 *
 * Reads HEULATRADE_MARKET_API_BASE_URL and HEULATRADE_MARKET_API_KEY from the environment
 * (Bun loads .env.local). Never prints env values, headers or the provider host; only API paths.
 * Request headers are never written. Response bodies are sanitized (src/server/market/fixture-layout.ts)
 * and re-validated before anything is written. Output is staged in a temp dir and swapped in
 * atomically, so a failed run leaves the previous dataset untouched.
 *
 * Must not import anything that imports `server-only` (Bun resolves its throwing entry).
 */
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fixturePath, hostOf, manifestSchema, REPORT_TYPES, sanitizeRecording, schemaFor,
  type FixtureEndpoint, type FixtureManifest,
} from "../src/server/market/fixture-layout";
import { screenerResponseSchema } from "../src/server/schemas/arjum";
import { parseIndonesianDate } from "../src/server/services/screener-date";

const SYMBOL = /^[A-Z0-9]{1,12}$/;
const ALWAYS_RECORD = ["BBCA"];

export type RecordOptions = {
  baseUrl: string;
  apiKey: string;
  rootDir: string;
  symbolLimit?: number;
  delayMs?: number;
  fetcher?: typeof fetch;
  log?: (line: string) => void;
  now?: () => Date;
};

export type RecordResult = { ok: boolean; manifest?: FixtureManifest; outputDir?: string };

type Query = Record<string, string | number>;

export async function recordFixtures(options: RecordOptions): Promise<RecordResult> {
  const { baseUrl, apiKey, rootDir, symbolLimit = 25, delayMs = 250, fetcher = fetch, log = console.log, now = () => new Date() } = options;
  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const staging = join(rootDir, "fixtures", `.arjum-recording-${stamp}`);
  const destination = join(rootDir, "fixtures", "arjum");
  const host = hostOf(baseUrl);
  const secrets = [apiKey, ...(host ? [host, host.split(":")[0]] : [])];
  const files: FixtureManifest["files"] = [];
  const failures: FixtureManifest["failures"] = [];
  let first = true;

  async function get(path: string, query: Query): Promise<{ status: number | string; body?: unknown }> {
    if (!first && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    first = false;
    const url = new URL(path.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
    try {
      const response = await fetcher(url, { headers: { "x-api-key": apiKey, accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) return { status: response.status };
      return { status: response.status, body: await response.json() };
    } catch {
      return { status: "NETWORK_ERROR" };
    }
  }

  async function record(endpoint: FixtureEndpoint, apiPath: string, query: Query, where: { symbol?: string; reportType?: string; searchKey?: string } = {}): Promise<unknown | null> {
    const label = `${apiPath}${Object.keys(query).length ? `?${new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]))}` : ""}`;
    const result = await get(apiPath, query);
    const fail = (status: number | string) => {
      failures.push({ endpoint, ...(where.symbol ? { symbol: where.symbol } : {}), status });
      log(`✗ ${label} → ${status}`);
      return null;
    };
    if (result.body === undefined) return fail(result.status);
    const schema = schemaFor(endpoint);
    if (!schema.safeParse(result.body).success) return fail("SCHEMA_MISMATCH");
    const clean = schema.safeParse(sanitizeRecording(result.body, secrets));
    if (!clean.success) return fail("INVALID_AFTER_SANITIZE");
    const relative = fixturePath(endpoint, where);
    mkdirSync(dirname(join(staging, relative)), { recursive: true });
    writeFileSync(join(staging, relative), `${JSON.stringify(clean.data, null, 2)}\n`);
    files.push({ path: relative, endpoint, ...(where.symbol ? { symbol: where.symbol } : {}), params: query });
    log(`✓ ${label} → ${relative}`);
    return clean.data;
  }

  mkdirSync(staging, { recursive: true });
  try {
    const screenerRaw = await record("screener", "/api/screener/latest", {});
    if (!screenerRaw) {
      log("Screener could not be recorded; nothing was written.");
      return { ok: false };
    }
    const screener = screenerResponseSchema.parse(screenerRaw);
    const matched = [...new Set(screener.rows.map((row) => row.stock_code.trim().toUpperCase()).filter((code) => SYMBOL.test(code)))];
    if (matched.length > symbolLimit) log(`Screener matched ${matched.length} symbols; recording the first ${symbolLimit}.`);
    const symbols = [...new Set([...matched.slice(0, symbolLimit), ...ALWAYS_RECORD])];

    await record("market-cap", "/api/market-cap", { page: 1 });
    await record("health", "/api/health", {});

    for (const symbol of symbols) {
      const at = { symbol };
      await record("search", "/api/search", { q: symbol }, { searchKey: symbol });
      await record("broker-summary", `/api/broker-summary/${symbol}`, {}, at);
      await record("broker-accumulation", `/api/broker-accumulation/${symbol}`, {}, at);
      await record("history", `/api/history/${symbol}`, { frame: "daily", limit: 120 }, at);
      await record("seasonal", `/api/seasonal/${symbol}`, {}, at);
      for (const reportType of REPORT_TYPES) {
        await record("financial-statements", `/api/financial-statements/${symbol}`, { report_type: reportType, period: "quarterly", limit: 12 }, { symbol, reportType });
      }
      await record("insiders", `/api/insiders/${symbol}`, { page: 1, limit: 50 }, at);
      await record("done-details", "/api/done-details", { code: symbol, page: 1, per_page: 100 }, at);
    }

    const manifest = manifestSchema.parse({
      provider: "arjum",
      recordedAt: now().toISOString(),
      screenerDate: parseIndonesianDate(screener.date),
      symbols: symbols.filter((symbol) => files.some((file) => file.symbol === symbol)),
      files,
      failures,
    });
    writeFileSync(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

    // Atomic swap: previous dataset is moved aside, staging takes its place, previous is removed.
    const previous = join(rootDir, "fixtures", `.arjum-previous-${stamp}`);
    if (existsSync(destination)) renameSync(destination, previous);
    try {
      renameSync(staging, destination);
    } catch (error) {
      if (existsSync(previous)) renameSync(previous, destination);
      throw error;
    }
    rmSync(previous, { recursive: true, force: true });
    log(`Recorded ${files.length} files for ${manifest.symbols.length} symbols (${failures.length} failures) → fixtures/arjum`);
    return { ok: true, manifest, outputDir: destination };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

const isEntryPoint = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntryPoint) {
  const baseUrl = process.env.HEULATRADE_MARKET_API_BASE_URL?.trim();
  const apiKey = process.env.HEULATRADE_MARKET_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    console.error("Set HEULATRADE_MARKET_API_BASE_URL and HEULATRADE_MARKET_API_KEY (e.g. in .env.local). Values are never printed.");
    process.exit(1);
  }
  const limitIndex = process.argv.indexOf("--limit");
  const symbolLimit = limitIndex > -1 ? Number(process.argv[limitIndex + 1]) : 25;
  if (!Number.isInteger(symbolLimit) || symbolLimit < 0) {
    console.error("--limit must be a non-negative integer");
    process.exit(1);
  }
  const result = await recordFixtures({ baseUrl, apiKey, rootDir: join(dirname(fileURLToPath(import.meta.url)), ".."), symbolLimit });
  process.exit(result.ok ? 0 : 1);
}
