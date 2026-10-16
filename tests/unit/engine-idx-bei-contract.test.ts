// The Data Engine's /v1 routes must be consumable by the app's IdxBeiSource (MARKET_API_URL) without crashing:
// the E1 stubs (no stored data) and the E2/E2b responses built from stored rows.
// Lives here, not in services/engine, because it typechecks app code (Next/DOM fetch types).
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketDataError } from "@/server/market/errors";
import { IdxBeiSource } from "@/server/market/idx-bei-source";
import { LocalRawStore } from "../../services/engine/src/fetch/raw-store";
import { MemoryCursorStore, MemoryRawDocumentIndex, MemoryRunRecorder, MemorySourceStateStore } from "../../services/engine/src/fetch/stores";
import { createApp, type AppDeps } from "../../services/engine/src/http/app";
import { OwnershipService } from "../../services/engine/src/ownership/service";
import { MemoryOwnershipStore } from "../../services/engine/src/ownership/store";
import { PauseGuard } from "../../services/engine/src/schedule/pause";
import { Scheduler } from "../../services/engine/src/schedule/scheduler";
import { MemoryMarketStore } from "../../services/engine/src/serve/store";
import { fixtureStrategyStore } from "../../services/engine/test/strategy-fixtures";

const BASE = "http://engine.test";
const NOW = new Date("2026-10-14T10:00:00Z");

function engineFetch(dir: string, now: Date, market?: AppDeps["market"], strategies?: AppDeps["strategies"]) {
  const pause = new PauseGuard(dir, 85, { cacheMs: 0, measure: async () => 10 });
  const sourceState = new MemorySourceStateStore();
  const scheduler = new Scheduler({ jobs: [], pause, runs: new MemoryRunRecorder(), cursors: new MemoryCursorStore(), sourceState });
  const app = createApp({ ping: async () => true, pause, scheduler, rawStoreKind: "local", sourceHealth: async () => [], unblockSource: async () => false, now: () => now, market, strategies });
  return ((input: string | URL | Request, init?: RequestInit) => app(new Request(input, init))) as typeof fetch;
}

describe("engine /v1 stubs via IdxBeiSource", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "engine-contract-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("parses every stub and labels it UNAVAILABLE", async () => {
    const source = new IdxBeiSource(BASE, () => NOW, engineFetch(dir, NOW));

    const market = await source.marketOverview();
    expect(market.freshness).toBe("UNAVAILABLE");
    expect(market.data.indices).toEqual([]);
    expect((await source.securities("")).data).toEqual([]);
    expect((await source.news({})).data).toEqual([]);
    expect((await source.announcements({ keywords: "dividen" })).data).toEqual([]);
    expect((await source.fundamentals("BBCA")).data).toEqual([]);
    expect((await source.corporateActions("BBCA")).data).toEqual([]);
    expect((await source.screen({ conditions: [], limit: 10 })).data.rows).toEqual([]);
    expect(await source.macro()).toMatchObject({ freshness: "UNAVAILABLE", data: { series: [] } });
    // Strategy scans off (the default): the empty board.
    expect(await source.engineStrategies()).toMatchObject({ freshness: "UNAVAILABLE", asOf: null, data: { contexts: [], strategies: [], candidates: [] } });
    // No price data yet: a typed provider error, never a fake quote.
    await expect(source.stock("BBCA")).rejects.toBeInstanceOf(MarketDataError);
    await expect(source.foreignFlow()).rejects.toBeInstanceOf(MarketDataError);
  });
});

describe("engine /v1 real responses via IdxBeiSource", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "engine-contract-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  const asOf = new Date("2026-10-16T09:35:00Z");
  const store = (withIntraday: boolean) => new MemoryMarketStore({
    securities: [
      { symbol: "BBCA", name: "PT Bank Central Asia Tbk", sector: "Finance", subsector: null, board: null, sharesOutstanding: 123_275_050_000, freeFloatPct: 40, asOf },
      { symbol: "GOTO", name: "PT GoTo Gojek Tokopedia Tbk", sector: "Technology Services", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf },
    ],
    daily: [
      { symbol: "BBCA", date: "2026-10-15", open: 6075, high: 6125, low: 6025, close: 6075, previousClose: 6125, volume: 134763200, value: 820e9, frequency: 30111, foreignBuy: 70e6, foreignSell: 90e6 },
      { symbol: "BBCA", date: "2026-10-16", open: 5825, high: 5825, low: 5175, close: 5225, previousClose: 6075, volume: 999771300, value: 5196076490000, frequency: null, foreignBuy: 310e6, foreignSell: 420e6 },
      { symbol: "GOTO", date: "2026-10-16", open: 23, high: 25, low: 23, close: 24, previousClose: 27, volume: 22181589400, value: 532358145600, frequency: null, foreignBuy: null, foreignSell: null },
    ],
    indexDaily: [{ code: "COMPOSITE", name: "IDX Composite Index", date: "2026-10-16", close: 5232.855, previousClose: 5863.78, changePercent: -0.1076 }],
    intraday: !withIntraday ? [] : [{ symbol: "BBCA", ts: new Date("2026-10-19T02:55:00Z"), last: 5400, open: 5300, high: 5450, low: 5250, changePercent: 0.0335, volume: 50_000_000, value: 270e9 }],
    actions: [{ symbol: "BBCA", exDate: "2021-10-13", type: "SPLIT", description: "Stock split 5:1", asOf }],
    news: [
      { publishedAt: new Date("2026-10-16T07:16:31Z"), publishedAtEstimated: false, title: "Review MSCI Bikin IHSG Anjlok Hingga 11%", url: "https://www.cnbcindonesia.com/market/20261016141345-17-776891/review-msci", outlet: "CNBC Indonesia", summary: "Wakil Ketua DPR menanggapi anjloknya IHSG.", symbols: [] },
      { publishedAt: new Date("2026-10-16T06:51:19Z"), publishedAtEstimated: false, title: "Asing lepas BBCA", url: "https://www.antaranews.com/berita/1/asing-lepas-bbca", outlet: "ANTARA", summary: null, symbols: ["BBCA"] },
    ],
    macro: [{ series: "JISDOR", date: "2026-10-16", value: 17948, link: null }, { series: "BI_RATE", date: "2026-09-23", value: 5.75, link: null }],
    fundamentals: [
      { symbol: "BBCA", periodEnd: "2026-06-30", periodType: "quarterly", metric: "netIncome", value: 14_850_323e6, unit: "amount", currency: "IDR", source: "yahoo-fundamentals" },
      { symbol: "BBCA", periodEnd: "2026-06-30", periodType: "quarterly", metric: "equity", value: 270_437_543e6, unit: "amount", currency: "IDR", source: "yahoo-fundamentals" },
      { symbol: "BBCA", periodEnd: "2025-12-31", periodType: "annual", metric: "netIncome", value: 57_537_287e6, unit: "amount", currency: "IDR", source: "yahoo-fundamentals" },
      { symbol: "BBCA", periodEnd: "2025-12-31", periodType: "annual", metric: "epsDiluted", value: 467, unit: "per_share", currency: "IDR", source: "yahoo-fundamentals" },
    ],
    ratios: [
      { symbol: "BBCA", ratio: "per", ratioSource: "derived", value: 11.06, date: "2026-10-16" },
      { symbol: "BBCA", ratio: "roe", ratioSource: "derived", value: 0.2147, date: "2026-10-16" },
      { symbol: "GOTO", ratio: "per", ratioSource: "derived", value: null, date: "2026-10-16" },
      { symbol: "GOTO", ratio: "pbv", ratioSource: "pasardana", value: 1.97, date: "2026-10-15" },
    ],
  });

  it("parses stored EOD data with freshness re-derived by the app", async () => {
    // IdxBeiSource caches by path in module state; a fresh module keeps the stub test's entries out.
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const now = new Date("2026-10-16T11:00:00Z"); // 18:00 WIB, after the close
    const source = new FreshSource(BASE, () => now, engineFetch(dir, now, store(false)));

    const market = await source.marketOverview();
    expect(market).toMatchObject({ freshness: "EOD", asOf: "2026-10-16" });
    expect(market.data.indices[0]).toMatchObject({ code: "COMPOSITE", close: 5232.855 });
    expect(market.data.indices[0].changePercent).toBeCloseTo(-10.76, 2);
    expect(market.data.breadth).toMatchObject({ advancers: 0, decliners: 2 });
    expect(market.data.movers.map((row) => row.symbol).sort()).toEqual(["BBCA", "GOTO"]);

    const stock = await source.stock("BBCA");
    expect(stock).toMatchObject({ freshness: "EOD", asOf: "2026-10-16" });
    expect(stock.data.quote).toMatchObject({ date: "2026-10-16", close: 5225, previousClose: 6075, foreignBuyShares: 310e6 });
    expect(stock.data.candles.map((candle) => candle.date)).toEqual(["2026-10-15", "2026-10-16"]);

    expect((await source.securities("goto")).data).toEqual([{ symbol: "GOTO", companyName: "PT GoTo Gojek Tokopedia Tbk", sector: "Technology Services", subsector: null, board: null }]);
    expect((await source.corporateActions("BBCA")).data).toEqual([{ date: "2021-10-13", type: "SPLIT", description: "Stock split 5:1", documentUrl: null }]);

    const flow = await source.foreignFlow();
    expect(flow).toMatchObject({ freshness: "EOD", data: { tradingDate: "2026-10-16" } });
    expect(flow.data.rows[0]).toMatchObject({ symbol: "BBCA", sessions: 2, direction: "net_sell", netForeignShares: -130e6 });

    // The news panel's request (`page`, `page_size`): newest first, headline + link + time + the feed's summary.
    const news = await source.news({ page: 1, perPage: 30 });
    expect(news).toMatchObject({ freshness: "HISTORICAL", asOf: "2026-10-16T14:16:31+07:00" });
    expect(news.data).toEqual([
      { date: "2026-10-16T14:16:31+07:00", title: "Review MSCI Bikin IHSG Anjlok Hingga 11%", summary: "Wakil Ketua DPR menanggapi anjloknya IHSG.", url: "https://www.cnbcindonesia.com/market/20261016141345-17-776891/review-msci", outlet: "CNBC Indonesia", symbols: [], dateEstimated: false },
      { date: "2026-10-16T13:51:19+07:00", title: "Asing lepas BBCA", summary: null, url: "https://www.antaranews.com/berita/1/asing-lepas-bbca", outlet: "ANTARA", symbols: ["BBCA"], dateEstimated: false },
    ]);
    expect((await source.news({ page: 2, perPage: 30 })).data).toEqual([]);

    const macro = await source.macro();
    expect(macro).toMatchObject({ freshness: "EOD", asOf: "2026-10-16" });
    expect(macro.data.series.map((row) => [row.id, row.value])).toEqual([["BI_RATE", 5.75], ["JISDOR", 17948]]);
  });

  it("parses fundamentals (E5) as HISTORICAL periods, newest first", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const now = new Date("2026-10-16T11:00:00Z");
    const source = new FreshSource(BASE, () => now, engineFetch(dir, now, store(false)));
    const fundamentals = await source.fundamentals("BBCA");
    expect(fundamentals).toMatchObject({ freshness: "HISTORICAL", asOf: "2026-06-30", period: "2026-06-30" });
    expect(fundamentals.data).toEqual([
      { periodDate: "2026-06-30", periodType: "QUARTERLY", metrics: { equity: 270_437_543e6, netIncome: 14_850_323e6 }, units: { equity: "IDR", netIncome: "IDR" }, currency: "IDR", source: "yahoo-fundamentals" },
      { periodDate: "2025-12-31", periodType: "ANNUAL", metrics: { epsDiluted: 467, netIncome: 57_537_287e6 }, units: { epsDiluted: "IDR/share", netIncome: "IDR" }, currency: "IDR", source: "yahoo-fundamentals" },
    ]);
    // A symbol without statements keeps the empty form.
    expect((await source.fundamentals("GOTO")).data).toEqual([]);
  });

  it("screens the newest session (E5): change1D in percent both ways, ratios with their source, nulls kept", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const now = new Date("2026-10-16T11:00:00Z");
    const source = new FreshSource(BASE, () => now, engineFetch(dir, now, store(false)));
    // The app sends change1D in percent (−12 %); IdxBeiSource converts it to the API's fraction.
    const screen = await source.screen({ conditions: [{ field: "change1D", operator: "LT", value: -12, connective: "AND" }], limit: 500 });
    expect(screen).toMatchObject({ freshness: "EOD", asOf: "2026-10-16" });
    expect(screen.data.total).toBe(1);
    expect(screen.data.rows[0]).toMatchObject({ symbol: "BBCA", name: "PT Bank Central Asia Tbk", price: 5225, per: 11.06, roe: 0.2147, pbv: null, foreignNetShares: -110e6 });
    expect(screen.data.rows[0].change1D).toBeCloseTo((5225 / 6075 - 1) * 100, 9);

    const all = await source.screen({ conditions: [{ field: "price", operator: "GT", value: 0, connective: "AND" }], limit: 500 });
    expect(all.data.rows.map((row) => row.symbol)).toEqual(["BBCA", "GOTO"]);
    expect(all.data.rows[1]).toMatchObject({ symbol: "GOTO", per: null, pbv: 1.97, marketCap: null });
    // No frequency in this session's rows: the field is not offered.
    expect(all.data.supportedFields).toEqual(["price", "volume", "value", "foreignNetShares", "marketCap", "per", "pbv", "roe", "change1D"]);
    expect(all.data.ratioSources).toEqual({ BBCA: { per: "derived", roe: "derived" }, GOTO: { per: "derived", pbv: "pasardana" } });
  });

  it("parses an intraday quote from a newer session as DELAYED", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const now = new Date("2026-10-19T03:05:00Z"); // Monday 10:05 WIB, in session
    const stock = await new FreshSource(BASE, () => now, engineFetch(dir, now, store(true))).stock("BBCA");
    expect(stock).toMatchObject({ freshness: "DELAYED", asOf: "2026-10-19T09:55:00+07:00" });
    expect(stock.data.quote).toMatchObject({ date: "2026-10-19", close: 5400, previousClose: 5225, change: 175 });
  });

  it("parses the strategy board (/v1/strategies) and the app's engine strategy source merges it after arjum", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const { strategyBoard, strategySources } = await import("@/server/strategies");
    const now = new Date("2026-10-16T11:00:00Z"); // Friday 18:00 WIB: the 2026-10-15 scan is a session old
    const source = new FreshSource(BASE, () => now, engineFetch(dir, now, undefined, { enabled: true, store: fixtureStrategyStore() }));

    const lane = await source.engineStrategies();
    expect(lane).toMatchObject({ freshness: "STALE", asOf: "2026-10-15", source: "idx-bei" });
    expect(lane.data.candidates.map((candidate) => `${candidate.strategyId}:${candidate.symbol}`)).toEqual(["breakout:BRKT", "bb-reversal:BBRV"]);

    const arjum = { strategies: async () => ({ data: { date: "2026-10-16", screenerVersion: "V5.2", marketCondition: null, universe: null, strategies: [] }, freshness: "EOD", asOf: "2026-10-16", source: "fixture:arjum" }) };
    const board = await strategyBoard(strategySources(arjum as never, { STRATEGY_ENGINE_ENABLED: "1" }, () => source));
    expect(board.data.strategies.map((strategy) => `${strategy.id}:${strategy.freshness}`)).toEqual(["eod-breakout:STALE", "eod-bb-reversal:STALE"]);
    expect(board.data.candidates.map((candidate) => `${candidate.strategyId}:${candidate.symbol}:${candidate.score}`)).toEqual(["eod-breakout:BRKT:null", "eod-bb-reversal:BBRV:null"]);
    expect(board.data.contexts.find((context) => context.source === "HAKAPRO_EOD_ENGINE")).toMatchObject({ version: "0.1-draft", universe: { covered: 7, liquid: 3, skipped: 4 } });
  });
});

describe("engine ownership routes via IdxBeiSource (E6, synthetic uploads)", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "engine-contract-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), "services/engine/test/fixtures/ownership", name)));

  async function ownershipFetch(now: Date, upload: boolean) {
    const service = new OwnershipService({ store: new MemoryOwnershipStore(), rawStore: new LocalRawStore(join(dir, "raw")), documents: new MemoryRawDocumentIndex(), now: () => now });
    if (upload) {
      for (const [name, month] of [["synthetic-1pct-2026-02.pdf", "2026-02"], ["synthetic-1pct-2026-03.pdf", "2026-03"]] as const) {
        await service.upload({ bytes: fixture(name), contentType: "application/pdf", fileName: name, asOfMonth: month, sourceLabel: `SYNTHETIC ${month}`, snapshotDate: null });
      }
    }
    const pause = new PauseGuard(dir, 85, { cacheMs: 0, measure: async () => 10 });
    const scheduler = new Scheduler({ jobs: [], pause, runs: new MemoryRunRecorder(), cursors: new MemoryCursorStore(), sourceState: new MemorySourceStateStore() });
    const app = createApp({
      ping: async () => true, pause, scheduler, rawStoreKind: "local", sourceHealth: async () => [], unblockSource: async () => false, now: () => now,
      ownership: { service, maxUploadBytes: 20 * 1024 * 1024, freeFloatEnabled: false },
    });
    return ((input: string | URL | Request, init?: RequestInit) => app(new Request(input, init))) as typeof fetch;
  }

  it("parses the empty forms as UNAVAILABLE", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const source = new FreshSource(BASE, () => NOW, await ownershipFetch(NOW, false));
    expect(await source.ownership("TEST1")).toMatchObject({ freshness: "UNAVAILABLE", asOf: null, data: { symbol: "TEST1", holders: [] } });
    expect(await source.ownershipChanges("2026-03")).toMatchObject({ freshness: "UNAVAILABLE", data: { changes: [] } });
  });

  it("parses stored months and changes as HISTORICAL, dated by the position date", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const source = new FreshSource(BASE, () => NOW, await ownershipFetch(NOW, true));
    const ownership = await source.ownership("TEST1");
    expect(ownership).toMatchObject({ freshness: "HISTORICAL", asOf: "2026-03-31", data: { month: "2026-03", freeFloat: null, source: { reference: "SYNTHETIC 2026-03" } } });
    expect(ownership.data.holders).toHaveLength(5);
    const changes = await source.ownershipChanges("2026-03", "TEST2");
    expect(changes).toMatchObject({ freshness: "HISTORICAL", asOf: "2026-03-31" });
    expect(changes.data.changes.find((change) => change.holderName === "PT FIKTIF HOLDCO")).toMatchObject({ kind: "DECREASE", shareDelta: "-10000000" });
    await expect(source.ownershipChanges("2026-3")).rejects.toThrow();
  });
});
