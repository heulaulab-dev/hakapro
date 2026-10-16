// Parsers against trimmed real responses recorded on 2026-10-16 (test/fixtures/, see README "Fixtures").
import { describe, expect, it } from "vitest";
import { fixture, wib } from "../../test/support";
import { historyUrl, parseHistory, quotaRemaining } from "./arjum";
import { getAllUrl, parseGetAll } from "./pasardana";
import { addDays, lastCompletedSession, sessionFinal, wibDateOf, wibIso, wibMidnightEpoch } from "./session";
import { delaySecondsOf, impliedPreviousClose, indexScanBody, marketScanBody, MARKET_COLUMNS, parseIndexScan, parseMarketScan } from "./tradingview";
import { chartUrl, ChartMismatchError, parseChart, yahooTicker } from "./yahoo";

describe("TradingView scanner", () => {
  it("parses the whole-market scan into IDX symbols with fractions and the stated delay", () => {
    const parsed = parseMarketScan(fixture("tradingview-indonesia-scan.json"));
    expect(parsed.totalCount).toBe(887);
    expect(parsed.skipped).toBe(0);
    expect(parsed.rows.map((row) => row.symbol)).toEqual(["BBCA", "BBRI", "BMRI", "TLKM", "GOTO"]);
    expect(parsed.rows[0]).toEqual({
      symbol: "BBCA", name: "PT Bank Central Asia Tbk", sector: "Finance", close: 5225, open: 5825, high: 5825, low: 5175,
      changePercent: expect.closeTo(-0.13991769547325102, 12), volume: 994464400, value: 5196076490000, marketCap: 755059662109375, delaySeconds: 600,
    });
    expect(impliedPreviousClose(parsed.rows[0].close, parsed.rows[0].changePercent)).toBe(6075);
    expect(impliedPreviousClose(parsed.rows[4].close, parsed.rows[4].changePercent)).toBe(27);
  });

  it("skips non-IDX tickers, odd symbols and malformed rows instead of failing the page", () => {
    const row = (s: string, name: string) => ({ s, d: [name, "x", null, 1, 1, 1, 1, 0, 1, 1, 1, "delayed_streaming_600"] });
    const parsed = parseMarketScan(JSON.stringify({ totalCount: 4, data: [row("IDX:AAAA", "AAAA"), row("IDX:BRPT_W", "BRPT_W"), row("NYSE:AAAA", "AAAA"), { s: "IDX:BBBB", d: ["BBBB"] }] }));
    expect(parsed.rows.map((r) => r.symbol)).toEqual(["AAAA"]);
    expect(parsed.skipped).toBe(3);
    expect(() => parseMarketScan('{"data":"nope"}')).toThrow();
  });

  it("parses the index scan (IHSG, LQ45, IDX30, IDX-IC sectors)", () => {
    const rows = parseIndexScan(fixture("tradingview-global-indices.json"));
    expect(rows.map((row) => row.code)).toEqual(["COMPOSITE", "LQ45", "IDX30", "IDXENERGY", "IDXBASIC", "IDXINDUST", "IDXHEALTH", "IDXFINANCE", "IDXPROPERT"]);
    expect(rows[0]).toMatchObject({ name: "IDX Composite Index", close: 5232.855, delaySeconds: 600 });
    expect(rows[0].changePercent).toBeCloseTo(-0.1076, 4);
    expect(impliedPreviousClose(rows[0].close, rows[0].changePercent, 3)).toBe(5863.78);
  });

  it("builds request bodies with the column order the parser expects", () => {
    expect(JSON.parse(marketScanBody(0, 1000))).toEqual({ columns: [...MARKET_COLUMNS], range: [0, 1000], sort: { sortBy: "Value.Traded", sortOrder: "desc" } });
    expect(JSON.parse(indexScanBody()).symbols.tickers[0]).toBe("IDX:COMPOSITE");
    expect(delaySecondsOf("delayed_streaming_600")).toBe(600);
    expect(delaySecondsOf("streaming")).toBe(0);
    expect(delaySecondsOf("endofday")).toBeNull();
  });
});

describe("Yahoo chart", () => {
  it("parses daily bars on the WIB calendar with a chained previous close", () => {
    const chart = parseChart(fixture("yahoo-chart-BBCA-5d.json"), "BBCA.JK");
    expect(chart.name).toBe("PT Bank Central Asia Tbk");
    expect(chart.bars.map((bar) => bar.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(chart.bars[0]).toEqual({ date: "2026-10-12", open: 6050, high: 6100, low: 5950, close: 5950, previousClose: 5950, volume: 97965100, adjClose: 5950 });
    expect(chart.bars[4]).toMatchObject({ close: 5225, previousClose: 6075, volume: 999771300 });
    expect(chart.splits).toEqual([]);
  });

  it("extracts splits and dividends with ex-dates", () => {
    const chart = parseChart(fixture("yahoo-chart-BBCA-2021-events.json"), "BBCA.JK");
    expect(chart.splits).toEqual([{ exDate: "2021-10-13", numerator: 5, denominator: 1, ratio: "5:1" }]);
    expect(chart.dividends).toEqual([{ exDate: "2021-11-17", amount: 25 }]);
    expect(chart.bars.map((bar) => bar.date)).toContain("2021-10-13");
  });

  it("parses IHSG and rejects a chart for another ticker", () => {
    const ihsg = parseChart(fixture("yahoo-chart-JKSE-5d.json"), "^JKSE");
    expect(ihsg.bars.length).toBeGreaterThanOrEqual(4);
    expect(ihsg.bars.every((bar) => bar.close > 1000)).toBe(true);
    expect(() => parseChart(fixture("yahoo-chart-BBCA-5d.json"), "BBRI.JK")).toThrow(ChartMismatchError);
    expect(() => parseChart('{"chart":{"result":null,"error":{"code":"Not Found"}}}', "XXXX.JK")).toThrow("no result");
  });

  it("drops bars without a close and tolerates a missing timestamp series", () => {
    const body = JSON.stringify({ chart: { result: [{ meta: { symbol: "AAAA.JK", gmtoffset: 25200, chartPreviousClose: 100 }, timestamp: [1792116000, 1792202400], indicators: { quote: [{ open: [1, null], high: [1, null], low: [1, null], close: [101, null], volume: [5, null] }] } }], error: null } });
    expect(parseChart(body, "AAAA.JK").bars).toEqual([{ date: "2026-10-16", open: 1, high: 1, low: 1, close: 101, previousClose: 100, volume: 5, adjClose: null }]);
    const empty = JSON.stringify({ chart: { result: [{ meta: { symbol: "AAAA.JK" }, indicators: { quote: [{}] } }], error: null } });
    expect(parseChart(empty, "AAAA.JK").bars).toEqual([]);
  });

  it("builds chart URLs for ranges and periods", () => {
    expect(chartUrl(yahooTicker("BBCA"), { range: "5d" })).toBe("https://query1.finance.yahoo.com/v8/finance/chart/BBCA.JK?range=5d&interval=1d&events=div%2Csplit");
    expect(chartUrl("^JKSE", { period1: 1, period2: 2 })).toBe("https://query1.finance.yahoo.com/v8/finance/chart/%5EJKSE?period1=1&period2=2&interval=1d&events=div%2Csplit");
  });
});

describe("Pasardana GetAll", () => {
  it("parses universe rows with IDX-IC sectors, shares, free float and the previous session's values", () => {
    const page = parseGetAll(fixture("pasardana-getall.json"));
    expect(page.received).toBe(3);
    expect(page.rows.map((row) => row.symbol)).toEqual(["AADI", "AALI", "ABBA"]);
    expect(page.rows[0]).toEqual({
      symbol: "AADI", name: "Adaro Andalan Indonesia Tbk.", sector: "Energi", subsector: "Minyak, Gas & Batu Bara", industry: "Batu Bara",
      date: "2026-10-15", open: 11425, high: 11425, low: 11025, close: 11300, previousClose: 11550,
      volume: 6322100, value: 70842097500, frequency: 5707, marketCap: 87991876888000, sharesOutstanding: 7786891760, freeFloatPct: 18.18,
      ratios: { per: 6.17137, pbv: 1.25254, roe: 0.24083955408348 },
    });
    expect(getAllUrl(2)).toBe("https://pasardana.id/api/StockSearchResult/GetAll?pageBegin=2&pageLength=200&sortField=Code&sortOrder=ASC");
  });

  it("skips rows with an unusable code", () => {
    const page = parseGetAll(JSON.stringify([{ Code: "AB-CD" }, { Code: "ABCD", Name: "X", LastDate: null }]));
    expect(page).toMatchObject({ received: 2, skipped: 1 });
    expect(page.rows[0]).toMatchObject({ symbol: "ABCD", date: null, close: null });
  });
});

describe("arjum history (fake response shaped like fixtures/arjum)", () => {
  it("maps foreign buy/sell per session and reads the quota header", () => {
    const sessions = parseHistory(fixture("arjum-history-BBCA.fake.json"), "BBCA");
    expect(sessions[0]).toEqual({
      date: "2026-10-16", open: 5825, high: 5825, low: 5175, close: 5225, previousClose: 6075, volume: 994464400, value: 5196076490000,
      frequency: 154210, foreignBuy: 310000000, foreignSell: 420000000,
    });
    expect(() => parseHistory(fixture("arjum-history-BBCA.fake.json"), "BBRI")).toThrow();
    expect(historyUrl("https://arjum.test", "BBCA")).toBe("https://arjum.test/api/history/BBCA?limit=20");
    expect(quotaRemaining(new Headers({ "x-ratelimit-remaining": "512" }))).toBe(512);
    expect(quotaRemaining(new Headers())).toBeNull();
  });
});

describe("session helpers", () => {
  it("knows when a session is final and which session is the latest complete one", () => {
    expect(sessionFinal(wib("2026-10-16", "16:14"))).toBe(false);
    expect(sessionFinal(wib("2026-10-16", "16:15"))).toBe(true);
    expect(lastCompletedSession(wib("2026-10-16", "12:00"))).toBe("2026-10-15");
    expect(lastCompletedSession(wib("2026-10-16", "16:45"))).toBe("2026-10-16");
    expect(lastCompletedSession(wib("2026-10-18", "10:00"))).toBe("2026-10-16"); // Sunday
    expect(wibIso(wib("2026-10-16", "10:20"))).toBe("2026-10-16T10:20:00+07:00");
    expect(wibDateOf(new Date("2026-10-15T18:00:00Z"))).toBe("2026-10-16");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(wibMidnightEpoch("2020-01-01")).toBe(Date.parse("2019-12-31T17:00:00Z") / 1000);
  });
});
