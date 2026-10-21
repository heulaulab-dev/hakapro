import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { idxBeiEnvelope, insidersRecentSchema } from "@/server/schemas/idx-bei";
import { tempDir } from "../../test/support";
import { MemoryCursorStore, MemoryRunRecorder, MemorySourceStateStore } from "../fetch/stores";
import { createApp } from "../http/app";
import { PauseGuard } from "../schedule/pause";
import { Scheduler } from "../schedule/scheduler";
import { insidersUrl, parseInsiders } from "../sources/arjum";
import { MemoryInsiderStore, serveRecentInsiders, type InsiderTransactionRecord } from "./insiders";

// 2026-10-21 17:00 WIB.
const NOW = new Date("2026-10-21T10:00:00Z");
const asOf = new Date("2026-10-20T15:00:00Z");

const tx = (row: Partial<InsiderTransactionRecord> & Pick<InsiderTransactionRecord, "symbol" | "date" | "action">): InsiderTransactionRecord => ({
  person: "A", roles: [], sharesChange: 1000, sharesBefore: null, sharesAfter: null, percentBefore: null, percentAfter: null, percentChange: null,
  price: 100, broker: null, nationality: "local", source: "arjum", asOf, ...row,
});

const store = () => new MemoryInsiderStore({
  active: ["BBCA", "BBRI", "TLKM", "GOTO"],
  checks: [
    { symbol: "BBCA", checkedDate: "2026-10-20", asOf },
    { symbol: "BBRI", checkedDate: "2026-10-15", asOf: new Date("2026-10-15T15:00:00Z") },
    // Outside the 7-day revisit window, and a delisted symbol: neither counts as covered.
    { symbol: "TLKM", checkedDate: "2026-10-14", asOf: new Date("2026-10-14T15:00:00Z") },
    { symbol: "OLDX", checkedDate: "2026-10-19", asOf: new Date("2026-10-19T15:00:00Z") },
  ],
  transactions: [
    tx({ symbol: "BBCA", date: "2026-10-16", action: "BUY", person: "Small", sharesChange: 100, price: 7000 }),
    tx({ symbol: "BBRI", date: "2026-10-16", action: "BUY", person: "Large", sharesChange: 1_000_000, price: 4000 }),
    tx({ symbol: "BBCA", date: "2026-10-18", action: "SELL", person: "Seller", sharesChange: -5000, price: null }),
    tx({ symbol: "TLKM", date: "2026-10-13", action: "BUY", person: "Too old" }),
    tx({ symbol: "BBRI", date: "2026-10-14", action: "CROSS", person: "Cross" }),
  ],
});

describe("serveRecentInsiders", () => {
  it("serves the window newest first (then by value) with the coverage of the revisit window", async () => {
    const result = await serveRecentInsiders(store(), { days: 7, limit: 50 }, 7, NOW);
    expect(result.served).not.toBeNull();
    const served = result.served!;
    expect(served).toMatchObject({ dataAsOf: asOf.toISOString(), freshness: "HISTORICAL" });
    expect(served.data).toMatchObject({ days: 7, from: "2026-10-14", to: "2026-10-21", action: null, coverage: { checked: 2, active: 4, revisitDays: 7, oldestCheck: "2026-10-15" } });
    expect(served.data.transactions.map((row) => row.person)).toEqual(["Seller", "Large", "Small", "Cross"]);
    // Value is |shares| × price, null without a price (never 0).
    expect(served.data.transactions.map((row) => row.value)).toEqual([null, 4_000_000_000, 700_000, 100_000]);
    expect(() => idxBeiEnvelope(insidersRecentSchema).parse({ data: served.data, meta: { source: "x", fetchedAt: NOW.toISOString(), dataAsOf: served.dataAsOf, freshness: "HISTORICAL" } })).not.toThrow();
  });

  it("filters by action and limits", async () => {
    const buys = (await serveRecentInsiders(store(), { days: 7, limit: 1, action: "buy" }, 7, NOW)).served!;
    expect(buys.data.action).toBe("buy");
    expect(buys.data.transactions.map((row) => [row.symbol, row.action])).toEqual([["BBRI", "BUY"]]);
    const sells = (await serveRecentInsiders(store(), { days: 30, limit: 50, action: "sell" }, 7, NOW)).served!;
    expect(sells.data.transactions.map((row) => row.person)).toEqual(["Seller"]);
  });

  it("answers with the empty form before the first read, still stating the universe size", async () => {
    const result = await serveRecentInsiders(new MemoryInsiderStore({ active: ["BBCA", "BBRI"], checks: [], transactions: [] }), { days: 7, limit: 50 }, 7, NOW);
    expect(result.served).toBeNull();
    expect(result.empty).toEqual({ days: 7, from: "2026-10-14", to: "2026-10-21", action: null, coverage: { checked: 0, active: 2, revisitDays: 7, oldestCheck: null }, transactions: [] });
  });
});

describe("GET /v1/insiders/recent", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => { dir = await tempDir(); });
  afterEach(async () => { await dir.cleanup(); });

  function call(path: string, insiders?: { store: MemoryInsiderStore; revisitDays: number }) {
    const pause = new PauseGuard(dir.path, 85, { cacheMs: 0, measure: async () => 10 });
    const scheduler = new Scheduler({ jobs: [], pause, runs: new MemoryRunRecorder(), cursors: new MemoryCursorStore(), sourceState: new MemorySourceStateStore() });
    const app = createApp({ ping: async () => true, pause, scheduler, rawStoreKind: "local", sourceHealth: async () => [], unblockSource: async () => false, now: () => NOW, insiders });
    return app(new Request(`http://engine.test${path}`));
  }

  it("is the UNAVAILABLE empty form without the feed, and validates its query", async () => {
    const response = await call("/v1/insiders/recent");
    expect(response.status).toBe(200);
    const body = idxBeiEnvelope(insidersRecentSchema).parse(await response.json());
    expect(body.meta).toMatchObject({ freshness: "UNAVAILABLE", dataAsOf: null });
    expect(body.data).toMatchObject({ days: 7, transactions: [], coverage: { checked: 0, active: 0 } });
    for (const bad of ["days=0", "days=31", "limit=201", "limit=x", "action=hold"]) {
      expect((await call(`/v1/insiders/recent?${bad}`)).status, bad).toBe(400);
    }
  });

  it("serves stored reads through the shared schema", async () => {
    const response = await call("/v1/insiders/recent?days=7&action=buy&limit=5", { store: store(), revisitDays: 7 });
    const body = idxBeiEnvelope(insidersRecentSchema).parse(await response.json());
    expect(body.meta).toMatchObject({ freshness: "HISTORICAL", dataAsOf: asOf.toISOString() });
    expect(body.data.transactions.map((row) => row.symbol)).toEqual(["BBRI", "BBCA"]);
    expect(body.data.coverage).toEqual({ checked: 2, active: 4, revisitDays: 7, oldestCheck: "2026-10-15" });
  });
});

describe("arjum insiders parsing", () => {
  const recorded = (symbol: string) => readFileSync(join(process.cwd(), "fixtures/arjum-baseline/symbols", symbol, "insiders.json"), "utf8");

  it("reads page 1 at the provider's largest page size", () => {
    expect(insidersUrl("https://arjum.example.test", "BBCA")).toBe("https://arjum.example.test/api/insiders/BBCA?page=1&limit=15");
  });

  it("parses through the app's normalizer: signed shares, percent units, no price when the source gives 0", () => {
    const body = JSON.stringify({
      stock_code: "DSSA", count: 2, total: 17, page: 1, page_size: 15, total_pages: 2,
      items: [
        { name: " DIAN  SWASTATIKA SENTOSA ", date: "2026-08-31", action_type: "sell", nationality: "local", previous_value: "33,950,956,750", previous_percentage: "17.62", current_value: "33,913,012,750", current_percentage: "17.60", changes_value: "-37,944,000", changes_percentage: "-0.02", price_formatted: "0", broker_code: "DH", badges: [] },
        { name: "TONNY KUSNADI", date: "2026-03-25", action_type: "buy", nationality: "", previous_value: "7,502,058", previous_percentage: "0.0061", current_value: "7,819,950", current_percentage: "0.0063", changes_value: "+317,892", changes_percentage: "+0.0002", price_formatted: "6,982", broker_code: "", badges: ["KOMISARIS"] },
        { name: "NO DATE", date: "", action_type: "buy", nationality: "local", previous_value: "", previous_percentage: "", current_value: "", current_percentage: "", changes_value: "", changes_percentage: "", price_formatted: "", broker_code: "", badges: [] },
      ],
    });
    const page = parseInsiders(body, "DSSA");
    expect(page.total).toBe(17);
    expect(page.rows).toEqual([
      { person: "DIAN SWASTATIKA SENTOSA", roles: [], action: "SELL", date: "2026-08-31", sharesChange: -37_944_000, sharesBefore: 33_950_956_750, sharesAfter: 33_913_012_750, percentBefore: 17.62, percentAfter: 17.6, percentChange: -0.02, price: null, broker: "DH", nationality: "local" },
      { person: "TONNY KUSNADI", roles: ["KOMISARIS"], action: "BUY", date: "2026-03-25", sharesChange: 317_892, sharesBefore: 7_502_058, sharesAfter: 7_819_950, percentBefore: 0.0061, percentAfter: 0.0063, percentChange: 0.0002, price: 6982, broker: null, nationality: null },
    ]);
    expect(() => parseInsiders(body, "BBCA")).toThrow(/returned where BBCA was requested/);
  });

  it("parses the recorded BBCA page", () => {
    const page = parseInsiders(recorded("BBCA"), "BBCA");
    expect(page.rows.length).toBeGreaterThan(0);
    expect(page.issues).toEqual([]);
    expect(page.rows.every((row) => ["BUY", "SELL", "CROSS", "OTHER"].includes(row.action))).toBe(true);
  });
});
