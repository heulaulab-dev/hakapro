import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { z } from "zod";
import type { Freshness, WithFreshness } from "@/lib/freshness";
import type { RawFetcher } from "@/server/providers/arjum/client";
import { searchResponseSchema, type SearchResponse } from "@/server/schemas/arjum";
import { ArjumSource, type Clock } from "./arjum-source";
import { MarketDataError } from "./errors";
import { GLOBAL_ENDPOINTS, manifestSchema, SYMBOL_ENDPOINTS, type FixtureManifest } from "./fixture-layout";

/** Written by `bun run record:fixtures`. */
export const RECORDED_DIR = "fixtures/arjum";
/** Frozen, committed samples (heulatrade, 2026-09-18). Unit tests pin to these. */
export const BASELINE_DIR = "fixtures/arjum-baseline";

/** Prefers a recorded dataset when one exists, otherwise the frozen baseline. */
export function defaultFixtureDir(cwd = process.cwd()): string {
  return existsSync(join(cwd, RECORDED_DIR, "manifest.json")) ? join(cwd, RECORDED_DIR) : join(cwd, BASELINE_DIR);
}

const notRecorded = (what: string) => new MarketDataError("NOT_RECORDED", `No recorded fixture for ${what}`, 404);

type Dataset = { manifest: FixtureManifest; read: (path: string) => unknown };

function openDataset(dir: string): Dataset {
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) throw new MarketDataError("NOT_RECORDED", "Fixture dataset has no manifest", 404);
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(manifestPath, "utf8")));
  return { manifest, read: (path) => JSON.parse(readFileSync(join(dir, path), "utf8")) };
}

/** Symbol carried inside a recorded body; used to refuse serving one symbol's data as another's. */
function bodySymbol(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  const value = record.stock_code ?? record.code;
  return typeof value === "string" ? value : undefined;
}

/**
 * Serves recorded responses through the same schemas and normalizers as the live provider.
 * Data for one symbol is never relabelled as another; unrecorded requests return NOT_RECORDED.
 * Query parameters are not applied, except the symbol, the search text and the financial report type.
 */
export function createFixtureFetcher(dir: string = defaultFixtureDir()): RawFetcher {
  return async <T extends z.ZodType>(path: string, schema: T, query: Record<string, unknown> = {}) => {
    const { manifest, read } = openDataset(dir);
    const find = (endpoint: string, symbol?: string, params: Record<string, string> = {}) =>
      manifest.files.find((file) => file.endpoint === endpoint && file.symbol === symbol
        && Object.entries(params).every(([key, value]) => String(file.params[key] ?? "") === value));

    let body: unknown;
    if (path === "/api/search") {
      const q = String(query.q ?? "").trim().toLowerCase();
      const rows = new Map<string, SearchResponse[number]>();
      for (const file of manifest.files.filter((entry) => entry.endpoint === "search")) {
        for (const row of searchResponseSchema.parse(read(file.path))) rows.set(row.stock_code, row);
      }
      body = [...rows.values()].filter((row) => !q || row.stock_code.toLowerCase().startsWith(q) || row._nn.includes(q));
    } else {
      const globalEndpoint = path === "/api/screener/latest" ? "screener" : path.replace(/^\/api\//, "");
      if (globalEndpoint in GLOBAL_ENDPOINTS) {
        const file = find(globalEndpoint);
        if (!file) throw notRecorded(globalEndpoint);
        body = read(file.path);
      } else {
        const match = path === "/api/done-details" ? ["", "done-details", String(query.code ?? "")] : /^\/api\/([a-z-]+)\/([A-Z0-9]+)$/.exec(path);
        const endpoint = match?.[1];
        const symbol = match?.[2];
        if (!endpoint || !symbol || !(endpoint in SYMBOL_ENDPOINTS)) throw notRecorded(path);
        const params: Record<string, string> = endpoint === "financial-statements" ? { report_type: String(query.report_type ?? "INCOME_STATEMENT") } : {};
        const file = find(endpoint, symbol, params);
        if (!file) throw notRecorded(`${endpoint} ${symbol}`);
        body = read(file.path);
        if (bodySymbol(body) !== symbol) throw notRecorded(`${endpoint} ${symbol} (recorded body is for ${bodySymbol(body) ?? "unknown"})`);
      }
    }
    return schema.parse(body) as z.infer<T>;
  };
}

/** Symbols with per-stock recordings in a dataset. */
export function recordedSymbols(dir: string = defaultFixtureDir()): string[] {
  return openDataset(dir).manifest.symbols;
}

/**
 * Fixture data is never current: anything the live rules would call LIVE/DELAYED/EOD/STALE is
 * reported as HISTORICAL, and an unknown as-of stays UNAVAILABLE.
 */
export function clampFixtureFreshness(freshness: Freshness, asOf: string | null): Freshness {
  return asOf === null || freshness === "UNAVAILABLE" ? "UNAVAILABLE" : "HISTORICAL";
}

export class FixtureSource extends ArjumSource {
  constructor(clock?: Clock, dir: string = defaultFixtureDir()) {
    super(createFixtureFetcher(dir), "fixture:arjum", clock);
  }

  protected override wrap<T>(data: T, freshness: Freshness, asOf: string | null, period?: string): WithFreshness<T> {
    return super.wrap(data, clampFixtureFreshness(freshness, asOf), asOf, period);
  }

  // Health of a recorded file says nothing about the provider; keep it explicit.
  override async providerHealth() {
    return this.wrap({ ok: false, status: "fixture" }, "UNAVAILABLE", null);
  }
}
