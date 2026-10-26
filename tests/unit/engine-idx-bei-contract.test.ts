// The Data Engine's /v1 routes must be consumable by the app's IdxBeiSource (MARKET_API_URL) without crashing:
// the E1 stubs (no stored data) and the E2/E2b responses built from stored rows.
// Lives here, not in services/engine, because it typechecks app code (Next/DOM fetch types).
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RADAR_RULES_V0, STEALTH_RULES_V0 } from "@/lib/radar/rules";
import { MarketDataError } from "@/server/market/errors";
import { IdxBeiSource } from "@/server/market/idx-bei-source";
import { LocalRawStore } from "../../services/engine/src/fetch/raw-store";
import { MemoryCursorStore, MemoryRawDocumentIndex, MemoryRunRecorder, MemorySourceStateStore } from "../../services/engine/src/fetch/stores";
import { createApp, type AppDeps } from "../../services/engine/src/http/app";
import { OwnershipService } from "../../services/engine/src/ownership/service";
import { MemoryOwnershipStore } from "../../services/engine/src/ownership/store";
import { PauseGuard } from "../../services/engine/src/schedule/pause";
import { Scheduler } from "../../services/engine/src/schedule/scheduler";
import { MemoryInsiderStore } from "../../services/engine/src/serve/insiders";
import { MemoryMarketStore } from "../../services/engine/src/serve/store";
import { recentInsidersSchema } from "@/lib/api/market";
import { fixtureStrategyStore } from "../../services/engine/test/strategy-fixtures";

const BASE = "http://engine.test";
const NOW = new Date("2026-10-14T10:00:00Z");

function engineFetch(dir: string, now: Date, market?: AppDeps["market"], strategies?: AppDeps["strategies"], insiders?: AppDeps["insiders"]) {
  const pause = new PauseGuard(dir, 85, { cacheMs: 0, measure: async () => 10 });
  const sourceState = new MemorySourceStateStore();
  const scheduler = new Scheduler({ jobs: [], pause, runs: new MemoryRunRecorder(), cursors: new MemoryCursorStore(), sourceState });
  const app = createApp({ ping: async () => true, pause, scheduler, rawStoreKind: "local", sourceHealth: async () => [], unblockSource: async () => false, now: () => now, market, strategies, insiders });
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
    expect(await source.heatmap({ limit: 30 })).toMatchObject({ freshness: "UNAVAILABLE", asOf: null, data: { limit: 30, stocks: [], sectors: [] } });
    // Only the engine's limits are ever sent.
    await expect(source.heatmap({ limit: 10 as never })).rejects.toThrow();
    // Groups: the empty form with the catalog version, never invented figures.
    const groups = await source.groups({ window: "5D" });
    expect(groups).toMatchObject({ freshness: "UNAVAILABLE", asOf: null, data: { window: { id: "5D", sessions: 0, from: null, to: null }, groups: [] } });
    expect(groups.data.catalog.version).toMatch(/^\d{4}-\d{2}-\d{2}/);
    // Strategy scans off (the default): the empty board.
    expect(await source.engineStrategies()).toMatchObject({ freshness: "UNAVAILABLE", asOf: null, data: { contexts: [], strategies: [], candidates: [] } });
    // Insider feed off (budget 0) or not run yet: the empty form, still parseable.
    expect(await source.recentInsiders({ days: 7, action: "buy" })).toMatchObject({
      freshness: "UNAVAILABLE", asOf: null,
      data: { days: 7, from: "2026-10-07", to: "2026-10-14", action: "buy", coverage: { checked: 0, active: 0, revisitDays: 7, oldestCheck: null }, transactions: [] },
    });
    // Radar and the KSEI corporate-holder view: empty forms with the rules echoed, never invented rows.
    const radar = await source.radar();
    expect(radar).toMatchObject({ freshness: "UNAVAILABLE", asOf: null, data: { tradingDate: null, stocks: [], kseiMonth: null, coverage: { stocks: 0 } } });
    expect(radar.data.rulesVersion).toBe(RADAR_RULES_V0.version);
    expect(await source.stealthOwnership()).toMatchObject({ freshness: "UNAVAILABLE", asOf: null, data: { month: null, stocks: [], rulesVersion: STEALTH_RULES_V0.version } });
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

    // Sectors over the same session rows as the movers, in percentage points like the rest of the app.
    const sectors = await source.sectors();
    expect(sectors).toMatchObject({ freshness: "EOD", asOf: "2026-10-16" });
    // Best change first: GOTO (−11.1%) before BBCA (−14.0%).
    expect(sectors.data.map((row) => [row.sector, row.stocks, row.decliners])).toEqual([["Technology Services", 1, 1], ["Finance", 1, 1]]);
    expect(sectors.data[1].changePercent).toBeCloseTo((5225 / 6075 - 1) * 100, 6);
    expect(sectors.data[1].leader.changePercent).toBeCloseTo(market.data.movers.find((row) => row.symbol === "BBCA")!.changePercent!, 6);

    // Heatmap over the same rows: most-traded first, percentage points, and the net foreign ESTIMATE only where the
    // session row has foreign buy/sell (BBCA), null otherwise (GOTO), never zero.
    const heatmap = await source.heatmap({});
    expect(heatmap).toMatchObject({ freshness: "EOD", asOf: "2026-10-16", source: "idx-bei", data: { limit: 100 } });
    expect(heatmap.data.stocks.map((row) => [row.symbol, row.sector, row.valueIdr])).toEqual([["BBCA", "Finance", 5196076490000], ["GOTO", "Technology Services", 532358145600]]);
    expect(heatmap.data.stocks[0]).toMatchObject({ name: "PT Bank Central Asia Tbk", close: 5225, volumeShares: 999771300, netForeignValueEstimateIdr: (310e6 - 420e6) * 5225 });
    expect(heatmap.data.stocks[0].changePercent).toBeCloseTo(market.data.movers.find((row) => row.symbol === "BBCA")!.changePercent!, 9);
    expect(heatmap.data.stocks[1].netForeignValueEstimateIdr).toBeNull();
    expect(heatmap.data.sectors.map((row) => [row.sector, row.stocks, row.valueIdr, row.netForeignValueEstimateIdr])).toEqual([
      ["Finance", 1, 5196076490000, (310e6 - 420e6) * 5225], ["Technology Services", 1, 532358145600, null],
    ]);
    expect(heatmap.data.sectors[1].changePercent).toBeCloseTo((24 / 27 - 1) * 100, 6);
    expect((await source.heatmap({ limit: 30 })).data.limit).toBe(30);
    // Conglomerate groups (curated catalog): the same 1D change as the movers, in percentage points; the foreign
    // figure is Σ (buy − sell shares) × close; catalog members the engine doesn't know are reported, not dropped.
    const groups = await source.groups({ window: "1D" });
    expect(groups).toMatchObject({ freshness: "EOD", asOf: "2026-10-16", data: { window: { id: "1D", sessions: 1, from: "2026-10-16", to: "2026-10-16", basis: "daily" } } });
    const djarum = groups.data.groups.find((group) => group.id === "djarum")!;
    expect(djarum).toMatchObject({ membersWithData: 1, decliners: 1, valueIdr: 5196076490000, best: { symbol: "BBCA" }, foreign: { members: 1, partialMembers: 0 } });
    expect(djarum.valueWeightedChangePercent).toBeCloseTo(market.data.movers.find((row) => row.symbol === "BBCA")!.changePercent!, 6);
    expect(djarum.foreign.netValueEstimateIdr).toBe((310e6 - 420e6) * 5225);
    // Price down and foreign net selling agree: no divergence.
    expect(djarum.divergence).toBeNull();
    expect(djarum.unknownSymbols).toEqual(expect.arrayContaining(["TOWR", "BELI"]));
    expect(djarum.stocks[0]).toMatchObject({ symbol: "BBCA", name: "PT Bank Central Asia Tbk", sessions: 1, foreignSessions: 1 });
    // Groups without any stored member come last, with null figures.
    expect(groups.data.groups.at(-1)).toMatchObject({ membersWithData: 0, changePercent: null, valueWeightedChangePercent: null });

    const fiveDay = await source.groups({ window: "5D" });
    expect(fiveDay.data.window).toEqual({ id: "5D", sessions: 2, from: "2026-10-15", to: "2026-10-16", basis: "daily" });
    const djarum5 = fiveDay.data.groups.find((group) => group.id === "djarum")!;
    expect(djarum5.changePercent).toBeCloseTo((5225 / 6125 - 1) * 100, 6);
    expect(djarum5.foreign.netValueEstimateIdr).toBe((70e6 - 90e6) * 6075 + (310e6 - 420e6) * 5225);

    // The market-wide calendar over an explicit range; the engine has no issuer profiles, so profile is unsupported.
    const calendar = await source.actionsCalendar({ from: "2021-10-01", to: "2021-10-31" });
    expect(calendar.data).toEqual([{ symbol: "BBCA", date: "2021-10-13", type: "SPLIT", description: "Stock split 5:1", amount: null, ratio: null, documentUrl: null }]);
    await expect(source.profile("BBCA")).rejects.toMatchObject({ code: "UNSUPPORTED" });

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

  it("parses the market-wide insider feed into the app's insider rows, with coverage and the newest read as as-of", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const now = new Date("2026-10-16T15:00:00Z"); // 22:00 WIB
    const readAt = new Date("2026-10-16T14:40:00Z");
    const insiders = new MemoryInsiderStore({
      active: ["BBCA", "GOTO", "TLKM"],
      checks: [{ symbol: "BBCA", checkedDate: "2026-10-16", asOf: readAt }, { symbol: "GOTO", checkedDate: "2026-10-12", asOf: new Date("2026-10-12T14:40:00Z") }],
      transactions: [
        { symbol: "BBCA", person: "BUDI CONTOH", roles: ["DIREKTUR"], action: "BUY", date: "2026-10-15", sharesChange: 500_000, sharesBefore: 1_000_000, sharesAfter: 1_500_000, percentBefore: 0.0008, percentAfter: 0.0012, percentChange: 0.0004, price: 6000, broker: null, nationality: "local", source: "arjum", asOf: readAt },
        { symbol: "GOTO", person: "PT INDUK", roles: [], action: "SELL", date: "2026-10-12", sharesChange: -1_000, sharesBefore: null, sharesAfter: null, percentBefore: null, percentAfter: null, percentChange: null, price: null, broker: "DH", nationality: null, source: "arjum", asOf: readAt },
      ],
    });
    const source = new FreshSource(BASE, () => now, engineFetch(dir, now, undefined, undefined, { store: insiders, revisitDays: 7 }));
    const feed = await source.recentInsiders({ days: 7 });
    expect(feed).toMatchObject({ freshness: "HISTORICAL", asOf: readAt.toISOString(), source: "idx-bei" });
    expect(feed.data).toMatchObject({ days: 7, from: "2026-10-09", to: "2026-10-16", action: null, coverage: { checked: 2, active: 3, revisitDays: 7, oldestCheck: "2026-10-12" } });
    expect(feed.data.transactions).toEqual([
      {
        symbol: "BBCA", person: "BUDI CONTOH", date: "2026-10-15", action: "BUY", roles: ["DIREKTUR"], broker: null, nationality: "local",
        previousShares: 1_000_000, currentShares: 1_500_000, changeShares: 500_000, previousPercent: 0.0008, currentPercent: 0.0012, changePercent: 0.0004,
        priceIdr: 6000, valueIdr: 3_000_000_000,
      },
      {
        symbol: "GOTO", person: "PT INDUK", date: "2026-10-12", action: "SELL", roles: [], broker: "DH", nationality: "",
        previousShares: null, currentShares: null, changeShares: -1000, previousPercent: null, currentPercent: null, changePercent: null, priceIdr: null, valueIdr: null,
      },
    ]);
    // The client schema accepts what the app serves.
    expect(recentInsidersSchema.parse(feed.data)).toEqual(feed.data);
    const sells = await source.recentInsiders({ days: 7, action: "sell", limit: 1 });
    expect(sells.data.transactions.map((row) => row.symbol)).toEqual(["GOTO"]);
  });

  it("screens the newest session (E5): change1D in percent both ways, ratios with their source, nulls kept", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const now = new Date("2026-10-16T11:00:00Z");
    const source = new FreshSource(BASE, () => now, engineFetch(dir, now, store(false)));
    // The app sends percentage points (−12 %); IdxBeiSource converts them to the API's fractions.
    const screen = await source.screen({ conditions: [{ field: "change1D", operator: "LT", value: -12, connective: "AND" }], limit: 500 });
    expect(screen).toMatchObject({ freshness: "EOD", asOf: "2026-10-16" });
    expect(screen.data.total).toBe(1);
    expect(screen.data.rows[0]).toMatchObject({ symbol: "BBCA", name: "PT Bank Central Asia Tbk", price: 5225, per: 11.06, roe: 21.47, pbv: null, foreignNetShares: -110e6 });
    expect(screen.data.rows[0].change1D).toBeCloseTo((5225 / 6075 - 1) * 100, 9);

    const all = await source.screen({ conditions: [{ field: "price", operator: "GT", value: 0, connective: "AND" }], limit: 500 });
    expect(all.data.rows.map((row) => row.symbol)).toEqual(["BBCA", "GOTO"]);
    expect(all.data.rows[1]).toMatchObject({ symbol: "GOTO", per: null, pbv: 1.97, marketCap: null });
    // No frequency in this session's rows: the field is not offered.
    expect(all.data.supportedFields).toEqual(["price", "volume", "value", "foreignNetShares", "marketCap", "per", "pbv", "roe", "change1D"]);
    expect(all.data.ratioSources).toEqual({ BBCA: { per: "derived", roe: "derived" }, GOTO: { per: "derived", pbv: "pasardana" } });
  });

  it("parses the radar (/v1/radar): signals with thresholds, counter-evidence, data status, the 1-day change in percent", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    // 21 sessions to 2026-10-16: foreign investors net sell 10 % of volume while the close rises; the newest session trades 3× the volume.
    const dates = Array.from({ length: 21 }, (_, index) => `2026-09-${String(index + 8).padStart(2, "0")}`).slice(0, 20).concat("2026-10-16");
    const rows = dates.map((date, index) => ({
      symbol: "BBCA", date, open: null, high: null, low: null, close: 6000 + index * 10, previousClose: 6000 + (index - 1) * 10,
      volume: index === 20 ? 3_000_000 : 1_000_000, value: 6e9, frequency: null, foreignBuy: 0, foreignSell: index === 20 ? 300_000 : 100_000,
    }));
    const radarStore = new MemoryMarketStore({
      securities: [{ symbol: "BBCA", name: "PT Bank Central Asia Tbk", sector: "Finance", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf }],
      daily: rows,
    });
    const now = new Date("2026-10-16T11:00:00Z");
    const radar = await new FreshSource(BASE, () => now, engineFetch(dir, now, radarStore)).radar();
    expect(radar).toMatchObject({ freshness: "EOD", asOf: "2026-10-16", data: { tradingDate: "2026-10-16", rulesVersion: RADAR_RULES_V0.version, coverage: { stocks: 1, listed: 1 } } });
    const [stock] = radar.data.stocks;
    expect(stock).toMatchObject({ symbol: "BBCA", name: "PT Bank Central Asia Tbk", sector: "Finance", close: 6200, firedCount: 1 });
    expect(stock.changePercent).toBeCloseTo((6200 / 6190 - 1) * 100, 6);
    expect(stock.fired).toEqual([{ key: "volumeSpike", observed: 3, threshold: RADAR_RULES_V0.signals.volumeSpike.threshold, window: "1D", detail: { volume: 3_000_000 } }]);
    expect(stock.counter.map((item) => item.key)).toEqual(["priceVsForeign5", "priceVsForeign20"]);
    expect(stock.status).toMatchObject({ foreignNetBuy5: "ok", orderSizeSpike: "missing", kseiHolderIncrease: "missing" });
    expect(radar.data.rules.foreignNetBuy5).toEqual({ window: 5, baseline: null, threshold: 0.05, unit: "fraction" });
  });

  it("parses an intraday quote from a newer session as DELAYED", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const now = new Date("2026-10-19T03:05:00Z"); // Monday 10:05 WIB, in session
    const source = new FreshSource(BASE, () => now, engineFetch(dir, now, store(true)));
    const stock = await source.stock("BBCA");
    expect(stock).toMatchObject({ freshness: "DELAYED", asOf: "2026-10-19T09:55:00+07:00" });
    expect(stock.data.quote).toMatchObject({ date: "2026-10-19", close: 5400, previousClose: 5225, change: 175 });
    // The heatmap follows the snapshot too; a snapshot has no foreign data, so no estimate.
    const heatmap = await source.heatmap({ limit: 50 });
    expect(heatmap).toMatchObject({ freshness: "DELAYED", asOf: "2026-10-19T09:55:00+07:00" });
    expect(heatmap.data.stocks).toEqual([{ symbol: "BBCA", name: "PT Bank Central Asia Tbk", sector: "Finance", close: 5400, changePercent: expect.closeTo((5400 / 5225 - 1) * 100, 9), valueIdr: 270e9, volumeShares: 50_000_000, netForeignValueEstimateIdr: null }]);
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

  async function ownershipFetch(now: Date, upload: boolean, market?: AppDeps["market"]) {
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
      ownership: { service, maxUploadBytes: 20 * 1024 * 1024, freeFloatEnabled: false }, market,
    });
    return ((input: string | URL | Request, init?: RequestInit) => app(new Request(input, init))) as typeof fetch;
  }

  it("parses the empty forms as UNAVAILABLE", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const source = new FreshSource(BASE, () => NOW, await ownershipFetch(NOW, false));
    expect(await source.ownership("TEST1")).toMatchObject({ freshness: "UNAVAILABLE", asOf: null, data: { symbol: "TEST1", holders: [] } });
    expect(await source.ownershipChanges({ month: "2026-03" })).toMatchObject({ freshness: "UNAVAILABLE", data: { changes: [] } });
    expect(await source.ownershipChanges({})).toMatchObject({ freshness: "UNAVAILABLE", data: { changes: [] } });
  });

  it("parses stored months and changes as HISTORICAL, dated by the position date", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const source = new FreshSource(BASE, () => NOW, await ownershipFetch(NOW, true));
    const ownership = await source.ownership("TEST1");
    expect(ownership).toMatchObject({ freshness: "HISTORICAL", asOf: "2026-03-31", data: { month: "2026-03", freeFloat: null, source: { reference: "SYNTHETIC 2026-03" } } });
    expect(ownership.data.holders).toHaveLength(5);
    const changes = await source.ownershipChanges({ month: "2026-03", symbol: "TEST2" });
    // Without a month: the newest stored month.
    expect((await source.ownershipChanges({})).data).toMatchObject({ month: "2026-03", previousMonth: "2026-02" });
    expect(changes).toMatchObject({ freshness: "HISTORICAL", asOf: "2026-03-31" });
    expect(changes.data.changes.find((change) => change.holderName === "PT FIKTIF HOLDCO")).toMatchObject({ kind: "DECREASE", shareDelta: "-10000000" });
    await expect(source.ownershipChanges({ month: "2026-3" })).rejects.toThrow();
  });

  it("parses the corporate-holder view: TEST1's CP parent added shares while the close slipped (percentage points)", async () => {
    vi.resetModules();
    const { IdxBeiSource: FreshSource } = await import("@/server/market/idx-bei-source");
    const bar = (date: string, close: number) => ({ symbol: "TEST1", date, open: null, high: null, low: null, close, previousClose: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null });
    const market = new MemoryMarketStore({ daily: [bar("2026-02-27", 1000), bar("2026-03-31", 990)] });
    const stealth = await new FreshSource(BASE, () => NOW, await ownershipFetch(NOW, true, market)).stealthOwnership();
    expect(stealth).toMatchObject({ freshness: "HISTORICAL", asOf: "2026-03-31", data: { month: "2026-03", coverage: { issuers: 3, corporateIncrease: 1 } } });
    expect(stealth.data.stocks).toHaveLength(1);
    expect(stealth.data.stocks[0]).toMatchObject({ symbol: "TEST1", combinedShareDelta: "10000000", holders: [{ holderName: "PT CONTOH INDUK FIKTIF", investorType: "CP", kind: "INCREASE" }] });
    expect(stealth.data.stocks[0].price!.changePercent).toBeCloseTo(-1, 9);
  });
});
