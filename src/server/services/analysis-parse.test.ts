import { describe, expect, test } from "vitest";
import { fixture, sample } from "../../../tests/support/fixtures";
import { analysisResponseSchema } from "@/server/schemas/arjum";
import { analysisNumber, parseAnalysis } from "./analysis-parse";

const parse = (body: unknown) => parseAnalysis(analysisResponseSchema.parse(body));

describe("analysis numbers", () => {
  test("Indonesian grouping without a suffix, English scale with a decimal dot", () => {
    expect(analysisNumber("Rp1.240", "idr")).toBe(1240);
    expect(analysisNumber("Rp398", "idr")).toBe(398);
    expect(analysisNumber("−Rp50", "idr")).toBe(-50);
    expect(analysisNumber("Rp1109.37B", "idr")).toBeCloseTo(1_109_370_000_000);
    expect(analysisNumber("−Rp176.06B", "idr")).toBeCloseTo(-176_060_000_000);
    expect(analysisNumber("177M", "shares")).toBe(177_000_000);
    expect(analysisNumber("−153K", "shares")).toBe(-153_000);
    expect(analysisNumber("1.767.537", "lots")).toBe(1_767_537);
    expect(analysisNumber("+2.48%", "percent")).toBe(2.48);
    expect(analysisNumber("2.0%", "percent")).toBe(2);
    expect(analysisNumber("abc", "idr")).toBeNull();
  });
});

describe("parseAnalysis on real texts", () => {
  test("BBCA 2026-09-18: every section, no unparsed lines", () => {
    const { data, issues, recognizedSections } = parse(fixture("analysis"));
    expect(issues).toEqual([]);
    expect(recognizedSections).toBe(8);
    expect(data).toMatchObject({ symbol: "BBCA", companyName: "Bank Central Asia Tbk.", date: "2026-09-18" });
    expect(data.price).toEqual({
      closeIdr: 6300, changeIdr: -50, changePercent: -0.79, previousCloseIdr: 6350, openIdr: 6325, highIdr: 6350, lowIdr: 6225,
      rangeIdr: 125, rangePercent: 2, pivots: { r2: 6417, r1: 6358, p: 6292, s1: 6233, s2: 6167 },
    });
    expect(data.technical).toEqual({
      sma: [{ period: 5, valueIdr: 6375 }, { period: 20, valueIdr: 6488 }, { period: 50, valueIdr: 6393 }],
      rsi14: 43, bollinger: { upperIdr: 6765, middleIdr: 6488, lowerIdr: 6210 }, macd: { macd: -10, signal: 27, histogram: -37 },
      atrIdr: 164, atrPercent: 2.61,
    });
    expect(data.volume).toEqual({ shares: 177_000_000, lots: 1_767_537, valueIdr: 1_109_370_000_000, frequency: 29_000, average20Shares: 121_000_000, ratio: 1.5, trend: "stable" });
    expect(data.foreign).toEqual({ side: "sell", netShares: -57_000_000, percentOfVolume: 32.1, recent: { buyDays: 0, sellDays: 5, sessions: 5, averageNetShares: -20_000_000 } });
    expect(data.brokers.total).toBe(73);
    expect(data.brokers.topSellers[0]).toEqual({ code: "ZP", netValueIdr: -312_380_000_000 });
    expect(data.brokers.heavySellers).toEqual(["ZP", "RX", "BK", "AK", "MG"]);
    expect(data.brokers.consistency[0]).toEqual({ code: "AK", side: "buy", days: 3, sessions: 5 });
    expect(data.brokers.moreConsistent).toBe(6);
    expect(data.score).toEqual({ value: 25, max: 75, tone: "neutral" });
    expect(data.factors.map((factor) => factor.key)).toEqual(["priceVsSma", "volume", "foreign", "brokers"]);
    expect(data.patterns[0]).toMatchObject({ pattern: { key: "foreignStrong", side: "sell" }, quality: "validSample", winRatePercent: 44.9, samples: 680, profitFactor: 1.05, drawdownPercent: -2 });
    expect(data.outlook).toEqual({ stance: "avoid", small: false, conditional: false, historicalEdge: false, entry: null, targets: [], stopLoss: { priceIdr: 6167, percent: null } });
  });

  test("2026-10-02 samples parse completely, with entries, targets and pattern variants", () => {
    for (const symbol of ["BBCA", "ARCI", "SAPX", "DSSA"]) expect(parse(sample(`analysis-${symbol}.json`)).issues).toEqual([]);
    const sapx = parse(sample("analysis-SAPX.json")).data;
    expect(sapx.outlook).toEqual({
      stance: "accumulate", small: true, conditional: false, historicalEdge: true,
      entry: { lowIdr: 370, highIdr: 418 }, targets: [{ priceIdr: 446, basis: "R1" }, { priceIdr: 396, basis: "weeklyPivot" }],
      stopLoss: { priceIdr: 342, percent: -14.1 },
    });
    expect(sapx.patterns.map((pattern) => pattern.pattern)).toEqual([
      { key: "combination", parts: ["foreign", "technical"] }, { key: "priceVsMa", position: "above", period: 5 },
      { key: "rsiRebound" }, { key: "priceVsMa", position: "above", period: 20 },
    ]);
    // Entry given high-to-low by the provider is normalized.
    expect(parse(sample("analysis-BBCA.json")).data.outlook?.entry).toEqual({ lowIdr: 5900, highIdr: 6000 });
    expect(parse(sample("analysis-BBCA.json")).data.factors.at(-1)).toEqual({ key: "rsiZone", tone: null, zone: "oversold" });
    expect(parse(sample("analysis-DSSA.json")).data.outlook).toMatchObject({ stance: "watch", conditional: true });
    expect(parse(sample("analysis-ARCI.json")).data.score).toEqual({ value: 35, max: 75, tone: "negative" });
  });

  test("provider prose never leaves the parser", () => {
    const serialized = ["BBCA", "ARCI", "SAPX", "DSSA"].map((symbol) => JSON.stringify(parse(sample(`analysis-${symbol}.json`)).data)).join("\n");
    for (const word of ["HINDARI", "AKUMULASI", "WATCH", "NETRAL", "WASPADA", "Jika", "Cut loss", "DISCLAIMER", "Catatan", "Sinyal", "Gabungan", "pantulan"]) expect(serialized).not.toContain(word);
  });

  test("unknown shapes are reported, not passed through", () => {
    const { data, issues, recognizedSections } = parse({ stock_code: "XXXX", output: "**🎯 SIGNAL**\n  Score: **10/75** — 🟣 **BARU**\n  • 🟢 Sesuatu yang baru\n  baris aneh\n**🪐 BAGIAN BARU**\n  isi" });
    expect(recognizedSections).toBe(1);
    expect(data.score).toEqual({ value: 10, max: 75, tone: null });
    expect(data.factors).toEqual([{ key: "other", tone: "positive" }]);
    expect(issues.map((issue) => issue.type)).toEqual(["unrecognized_value", "unparsed_line", "unknown_section"]);
  });
});
