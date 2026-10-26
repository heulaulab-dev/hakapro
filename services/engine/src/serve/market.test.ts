import { describe, expect, it } from "vitest";
import { wib } from "../../test/support";
import {
  foreignSignals, heatmapSectors, indicesOf, moversOf, netForeignValueEstimate, serveActions, serveHeatmap, serveMarket, serveSectors, serveSecurities, serveSignals, serveStock,
} from "./market";
import { MemoryMarketStore, type DailyRecord, type SecurityRecord } from "./store";

const day = (symbol: string, date: string, close: number, previousClose: number | null, extra: Partial<DailyRecord> = {}): DailyRecord => ({
  symbol, date, open: close, high: close, low: close, close, previousClose, volume: 1000, value: 2_000_000_000, frequency: 10, foreignBuy: null, foreignSell: null, ...extra,
});
const security = (symbol: string, name: string, extra: Partial<SecurityRecord> = {}): SecurityRecord => ({
  symbol, name, sector: "Finance", subsector: null, board: null, sharesOutstanding: null, freeFloatPct: null, asOf: wib("2026-10-16", "16:35"), ...extra,
});
const AFTER_CLOSE = wib("2026-10-16", "17:00");
const IN_SESSION_NEXT = wib("2026-10-19", "10:05");

describe("serveStock", () => {
  const store = new MemoryMarketStore({
    daily: [day("BBCA", "2026-10-15", 6075, 6125), day("BBCA", "2026-10-16", 5225, 6075, { foreignBuy: 10, foreignSell: 4 }), day("BBCA", "2026-10-14", 6125, 5950)],
    intraday: [{ symbol: "BBCA", ts: wib("2026-10-16", "15:39"), last: 5300, open: 5825, high: 5825, low: 5175, changePercent: -0.13, volume: 900, value: 1 }],
  });

  it("serves the newest daily row as an EOD quote with ascending candles", async () => {
    const served = (await serveStock(store, "BBCA", 2, AFTER_CLOSE))!;
    expect(served.freshness).toBe("EOD");
    expect(served.dataAsOf).toBe("2026-10-16");
    expect(served.data.quote).toMatchObject({ symbol: "BBCA", timestamp: "2026-10-16", close: 5225, previousClose: 6075, change: -850, foreignBuy: 10, foreignSell: 4 });
    expect(served.data.quote.changePercent).toBeCloseTo(-0.13992, 5);
    expect(served.data.candles.map((candle) => candle.time)).toEqual(["2026-10-15", "2026-10-16"]);
    // The intraday snapshot is from the same session as the daily row, so the daily row wins.
    expect(served.data.quote.close).toBe(5225);
  });

  it("serves a newer session's intraday snapshot as DELAYED with its WIB timestamp", async () => {
    store.data.intraday!.push({ symbol: "BBCA", ts: wib("2026-10-19", "09:55"), last: 5400, open: 5300, high: 5450, low: 5250, changePercent: 0.0335, volume: 50, value: 270_000 });
    const served = (await serveStock(store, "BBCA", 500, IN_SESSION_NEXT))!;
    expect(served.freshness).toBe("DELAYED");
    expect(served.dataAsOf).toBe("2026-10-19T09:55:00+07:00");
    expect(served.data.quote).toMatchObject({ timestamp: "2026-10-19T09:55:00+07:00", close: 5400, previousClose: 5225, change: 175, frequency: null, foreignBuy: null });
    expect(served.data.candles).toHaveLength(3);
  });

  it("returns null for a symbol without data", async () => {
    expect(await serveStock(store, "ZZZZ", 10, AFTER_CLOSE)).toBeNull();
  });
});

describe("serveMarket", () => {
  const rows = [
    day("AAAA", "2026-10-16", 110, 100), day("BBBB", "2026-10-16", 90, 100), day("CCCC", "2026-10-16", 100, 100),
    day("DDDD", "2026-10-16", 200, 100, { value: 10_000_000 }), // illiquid spike: not a gainer, still "active"
    day("AAAA", "2026-10-15", 100, 100),
  ];
  const store = new MemoryMarketStore({
    securities: [security("AAAA", "Alpha"), security("BBBB", "Beta")],
    daily: rows,
    indexDaily: [
      { code: "IDXFINANCE", name: "Fin", date: "2026-10-16", close: 1200, previousClose: 1300, changePercent: null },
      { code: "COMPOSITE", name: "IDX Composite Index", date: "2026-10-16", close: 5227, previousClose: 5863.78, changePercent: -0.1086 },
    ],
  });

  it("derives breadth, movers and ordered indices from the latest session", async () => {
    const served = (await serveMarket(store, AFTER_CLOSE))!;
    expect(served).toMatchObject({ dataAsOf: "2026-10-16", freshness: "EOD" });
    expect(served.data.breadth).toEqual({ advancers: 2, decliners: 1, unchanged: 1, value: 6_010_000_000, volume: 4000, frequency: 40 });
    expect(served.data.indices.map((row) => row.code)).toEqual(["COMPOSITE", "IDXFINANCE"]);
    expect(served.data.indices[1].changePercent).toBeCloseTo(-0.0769, 4);
    const movers = new Map(served.data.movers.map((row) => [row.symbol, row]));
    expect(movers.get("AAAA")).toMatchObject({ name: "Alpha", close: 110 });
    expect(movers.get("AAAA")!.changePercent).toBeCloseTo(0.1, 10);
    expect([...movers.keys()].sort()).toEqual(["AAAA", "BBBB", "CCCC", "DDDD"]);
  });

  it("switches to the intraday snapshot (DELAYED) once it is from a newer session", async () => {
    const ts = wib("2026-10-19", "09:55");
    store.data.intraday = [
      { symbol: "AAAA", ts, last: 121, open: 110, high: 121, low: 110, changePercent: 0.1, volume: 5, value: 605 },
      { symbol: "BBBB", ts, last: 90, open: 90, high: 90, low: 90, changePercent: 0, volume: 1, value: 90 },
    ];
    store.data.indexIntraday = [{ code: "COMPOSITE", name: "IDX Composite Index", ts, last: 5300, changePercent: 0.014 }];
    const served = (await serveMarket(store, IN_SESSION_NEXT))!;
    expect(served).toMatchObject({ dataAsOf: "2026-10-19T09:55:00+07:00", freshness: "DELAYED" });
    expect(served.data.breadth).toMatchObject({ advancers: 1, decliners: 0, unchanged: 1, value: 695, volume: 6, frequency: 0 });
    expect(served.data.indices[0]).toMatchObject({ code: "COMPOSITE", close: 5300, previousClose: 5227 });
    delete store.data.intraday;
    delete store.data.indexIntraday;
  });

  it("keeps the daily index row when the intraday one is from the same session", () => {
    const indices = indicesOf(
      [{ code: "LQ45", name: "LQ45", date: "2026-10-16", close: 519, previousClose: 590, changePercent: null }],
      [{ code: "LQ45", name: "LQ45", ts: wib("2026-10-16", "15:39"), last: 520, changePercent: -0.12 }],
    );
    expect(indices[0]).toMatchObject({ close: 519, asOf: "2026-10-16" });
  });

  it("returns null with no data at all", async () => {
    expect(await serveMarket(new MemoryMarketStore(), AFTER_CLOSE)).toBeNull();
    expect(moversOf([], new Map())).toEqual([]);
  });
});

describe("serveSectors", () => {
  it("groups the session by sector: breadth, mean and value-weighted change, leader and laggard, best first", async () => {
    const store = new MemoryMarketStore({
      securities: [
        security("AAAA", "Alpha"), security("BBBB", "Beta", { sector: "Keuangan" }), security("CCCC", "Gamma", { sector: "Energy" }),
        security("DDDD", "Delta", { sector: "Energy" }), security("EEEE", "Eps", { sector: null }),
      ],
      daily: [
        day("AAAA", "2026-10-16", 110, 100, { value: 3_000 }), day("BBBB", "2026-10-16", 95, 100, { value: 1_000 }),
        day("CCCC", "2026-10-16", 102, 100), day("DDDD", "2026-10-16", 100, 100), day("EEEE", "2026-10-16", 150, 100),
      ],
    });
    const served = (await serveSectors(store, AFTER_CLOSE))!;
    expect(served).toMatchObject({ dataAsOf: "2026-10-16", freshness: "EOD" });
    expect(served.data.map((row) => row.sector)).toEqual(["Finance", "Energy"]);
    const [finance, energy] = served.data;
    expect(finance).toMatchObject({ stocks: 2, advancers: 1, decliners: 1, unchanged: 0, value: 4_000, leader: { symbol: "AAAA" }, laggard: { symbol: "BBBB" } });
    expect(finance.changePercent).toBeCloseTo(0.025, 10);
    expect(finance.valueWeightedChangePercent).toBeCloseTo((0.1 * 3_000 - 0.05 * 1_000) / 4_000, 10);
    expect(energy).toMatchObject({ stocks: 2, advancers: 1, unchanged: 1 });
  });

  it("matches /v1/market's change for each stock and returns null without sectors or rows", async () => {
    const store = new MemoryMarketStore({ securities: [security("AAAA", "Alpha")], daily: [day("AAAA", "2026-10-16", 110, 100)] });
    const [sectors, market] = await Promise.all([serveSectors(store, AFTER_CLOSE), serveMarket(store, AFTER_CLOSE)]);
    expect(sectors!.data[0].leader.changePercent).toBe(market!.data.movers[0].changePercent);
    expect(await serveSectors(new MemoryMarketStore(), AFTER_CLOSE)).toBeNull();
    expect(await serveSectors(new MemoryMarketStore({ securities: [security("AAAA", "Alpha", { sector: null })], daily: [day("AAAA", "2026-10-16", 110, 100)] }), AFTER_CLOSE)).toBeNull();
  });
});

describe("serveHeatmap", () => {
  const store = () => new MemoryMarketStore({
    securities: [
      security("AAAA", "Alpha"), security("BBBB", "Beta"), security("CCCC", "Gamma", { sector: "Energy" }), security("DDDD", "Delta", { sector: null }),
    ],
    daily: [
      day("AAAA", "2026-10-16", 110, 100, { value: 5_000, volume: 50, foreignBuy: 30, foreignSell: 10 }),
      day("BBBB", "2026-10-16", 95, 100, { value: 4_000 }),
      day("CCCC", "2026-10-16", 100, 100, { value: 3_000, foreignBuy: 5, foreignSell: 25 }),
      day("DDDD", "2026-10-16", 120, 100, { value: 2_000 }),
      day("EEEE", "2026-10-16", 50, 100, { value: 1_000 }),
      day("FFFF", "2026-10-16", 10, 10, { value: 0 }),
      day("GGGG", "2026-10-16", 10, 10, { value: null }),
    ],
  });

  it("serves the most-traded stocks by value, with sector, change and the net foreign estimate", async () => {
    const served = (await serveHeatmap(store(), 100, AFTER_CLOSE))!;
    expect(served).toMatchObject({ dataAsOf: "2026-10-16", freshness: "EOD", data: { limit: 100 } });
    // No traded value: left out. Ordered by value.
    expect(served.data.stocks.map((row) => row.symbol)).toEqual(["AAAA", "BBBB", "CCCC", "DDDD", "EEEE"]);
    expect(served.data.stocks[0]).toEqual({ symbol: "AAAA", name: "Alpha", sector: "Finance", close: 110, changePercent: expect.closeTo(0.1, 10), value: 5_000, volume: 50, netForeignValueEstimate: 20 * 110 });
    expect(served.data.stocks[2].netForeignValueEstimate).toBe(-20 * 100);
    // No foreign data on the row: null, never zero.
    expect(served.data.stocks[1].netForeignValueEstimate).toBeNull();
    // No sector in the universe (DDDD) and not in the universe at all (EEEE): a literal null, never a made-up bucket.
    expect(served.data.stocks.slice(3).map((row) => [row.symbol, row.name, row.sector])).toEqual([["DDDD", "Delta", null], ["EEEE", null, null]]);
  });

  it("totals each sector (null included), largest value first", async () => {
    const { sectors } = (await serveHeatmap(store(), 100, AFTER_CLOSE))!.data;
    expect(sectors.map((row) => [row.sector, row.stocks, row.value])).toEqual([["Finance", 2, 9_000], ["Energy", 1, 3_000], [null, 2, 3_000]]);
    const [finance, energy, unknown] = sectors;
    expect(finance).toMatchObject({ advancers: 1, decliners: 1, unchanged: 0, netForeignValueEstimate: 2_200 });
    expect(finance.changePercent).toBeCloseTo((0.1 - 0.05) / 2, 10);
    expect(energy).toMatchObject({ unchanged: 1, changePercent: 0, netForeignValueEstimate: -2_000 });
    expect(unknown).toMatchObject({ advancers: 1, decliners: 1, netForeignValueEstimate: null });
    expect(unknown.changePercent).toBeCloseTo((0.2 - 0.5) / 2, 10);
  });

  it("cuts at the limit and matches /v1/market's change for each stock", async () => {
    const served = (await serveHeatmap(store(), 30, AFTER_CLOSE))!;
    expect(served.data.limit).toBe(30);
    const many = new MemoryMarketStore({ daily: Array.from({ length: 40 }, (_, index) => day(`S${String(index).padStart(3, "0")}`, "2026-10-16", 100 + index, 100, { value: 1_000 + index })) });
    const top = (await serveHeatmap(many, 30, AFTER_CLOSE))!.data.stocks;
    expect(top).toHaveLength(30);
    expect(top[0].symbol).toBe("S039");
    const market = (await serveMarket(store(), AFTER_CLOSE))!;
    const shared = market.data.movers.filter((mover) => served.data.stocks.some((row) => row.symbol === mover.symbol));
    expect(shared.length).toBeGreaterThan(0);
    for (const mover of shared) expect(served.data.stocks.find((row) => row.symbol === mover.symbol)!.changePercent).toBe(mover.changePercent);
  });

  it("has no foreign estimate on an intraday snapshot (DELAYED)", async () => {
    const intradayStore = store();
    const ts = wib("2026-10-19", "09:55");
    intradayStore.data.intraday = [{ symbol: "AAAA", ts, last: 121, open: 110, high: 121, low: 110, changePercent: 0.1, volume: 5, value: 605 }];
    const served = (await serveHeatmap(intradayStore, 100, IN_SESSION_NEXT))!;
    expect(served).toMatchObject({ freshness: "DELAYED", dataAsOf: "2026-10-19T09:55:00+07:00" });
    expect(served.data.stocks).toEqual([{ symbol: "AAAA", name: "Alpha", sector: "Finance", close: 121, changePercent: expect.closeTo(0.1, 10), value: 605, volume: 5, netForeignValueEstimate: null }]);
    expect(served.data.sectors[0].netForeignValueEstimate).toBeNull();
  });

  it("returns null without traded rows", async () => {
    expect(await serveHeatmap(new MemoryMarketStore(), 100, AFTER_CLOSE)).toBeNull();
    expect(await serveHeatmap(new MemoryMarketStore({ daily: [day("AAAA", "2026-10-16", 1, 1, { value: 0 })] }), 100, AFTER_CLOSE)).toBeNull();
  });

  it("estimates net foreign value only with buy, sell and close", () => {
    expect(netForeignValueEstimate({ close: 1000, foreignBuy: 300, foreignSell: 100 })).toBe(200_000);
    expect(netForeignValueEstimate({ close: null, foreignBuy: 300, foreignSell: 100 })).toBeNull();
    expect(netForeignValueEstimate({ close: 1000, foreignBuy: null, foreignSell: 100 })).toBeNull();
    expect(heatmapSectors([])).toEqual([]);
  });
});

describe("foreign signals", () => {
  const flows = (symbol: string, nets: Array<[string, number]>, extra: Partial<DailyRecord> = {}) =>
    nets.map(([date, net]) => day(symbol, date, 1000, 1000, { foreignBuy: 1_000_000 + Math.max(net, 0), foreignSell: 1_000_000 + Math.max(-net, 0), value: 4_000_000_000, ...extra }));

  it("measures the run of same-direction sessions ending on the trading date", () => {
    const rows = [
      ...flows("AAAA", [["2026-10-14", -5_000_000], ["2026-10-15", 2_000_000], ["2026-10-16", 3_000_000]]),
      ...flows("BBBB", [["2026-10-15", -1_000_000], ["2026-10-16", -9_000_000]]),
      ...flows("CCCC", [["2026-10-16", 0]]),
      ...flows("DDDD", [["2026-10-15", 1_000_000]]),
    ];
    const signals = foreignSignals(rows, "2026-10-16", new Map([["AAAA", 100_000_000]]));
    expect(signals).toEqual([
      { symbol: "BBBB", close: 1000, sessions: 2, netForeignMillionShares: -10, percentFloat: null, averageValueBillionIdr: 4, signal: "distribute" },
      { symbol: "AAAA", close: 1000, sessions: 2, netForeignMillionShares: 5, percentFloat: 5, averageValueBillionIdr: 4, signal: "accumulate" },
    ]);
  });

  it("serves the newest foreign-flow session, or null without foreign data", async () => {
    expect(await serveSignals(new MemoryMarketStore({ daily: [day("AAAA", "2026-10-16", 1, 1)] }), AFTER_CLOSE)).toBeNull();
    const store = new MemoryMarketStore({
      daily: flows("AAAA", [["2026-10-15", 1_000_000], ["2026-10-16", 1_000_000]]),
      securities: [security("AAAA", "Alpha", { sharesOutstanding: 1_000_000_000, freeFloatPct: 20 })],
    });
    const served = (await serveSignals(store, AFTER_CLOSE))!;
    expect(served).toMatchObject({ dataAsOf: "2026-10-16", freshness: "EOD", data: { tradingDate: "2026-10-16" } });
    expect(served.data.foreignFlow[0]).toMatchObject({ symbol: "AAAA", sessions: 2, netForeignMillionShares: 2, percentFloat: 1 });
  });
});

describe("securities and actions", () => {
  const store = new MemoryMarketStore({
    securities: [security("BBCA", "PT Bank Central Asia Tbk"), security("BBRI", "PT Bank Rakyat Indonesia"), security("TLKM", "PT Telkom Indonesia")],
    actions: [
      { symbol: "BBCA", exDate: "2021-10-13", type: "SPLIT", description: "Stock split 5:1", asOf: wib("2026-10-16", "20:00") },
      { symbol: "BBCA", exDate: "2021-11-17", type: "DIVIDEND", description: "Cash dividend IDR 25 per share", asOf: wib("2026-10-16", "20:00") },
    ],
  });

  it("searches by symbol prefix or name", async () => {
    expect((await serveSecurities(store, "bb", AFTER_CLOSE))!.data.map((row) => row.symbol)).toEqual(["BBCA", "BBRI"]);
    expect((await serveSecurities(store, "telkom", AFTER_CLOSE))!.data).toEqual([{ symbol: "TLKM", companyName: "PT Telkom Indonesia", sector: "Finance", subsector: null, board: null }]);
    expect((await serveSecurities(store, "", AFTER_CLOSE))!.data).toHaveLength(3);
    expect(await serveSecurities(store, "zzz", AFTER_CLOSE)).toBeNull();
  });

  it("lists corporate actions newest first", async () => {
    const served = (await serveActions(store, "BBCA", AFTER_CLOSE))!;
    expect(served.data).toEqual([
      { date: "2021-11-17", type: "DIVIDEND", description: "Cash dividend IDR 25 per share", documentUrl: null },
      { date: "2021-10-13", type: "SPLIT", description: "Stock split 5:1", documentUrl: null },
    ]);
    expect(await serveActions(store, "TLKM", AFTER_CLOSE)).toBeNull();
  });
});
