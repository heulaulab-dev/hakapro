import { describe, expect, it } from "vitest";
import type { MarketStore } from "./store";
import { serveIndicesHistory, serveMarketBrokerSummary } from "./market-info";

describe("serveIndicesHistory", () => {
  it("returns every stored IDX-IC sector code with history coverage", async () => {
    const codes = ["IDXNONCYC", "IDXCYCLIC", "IDXTECHNO", "IDXINFRA", "IDXTRANS"];
    const rows = codes.map((code, index) => ({
      code, name: null, date: "2026-10-26", close: 100 + index, previousClose: null, changePercent: null,
    }));
    const store = { indexDailyBetween: async () => rows } as unknown as MarketStore;

    const response = await serveIndicesHistory(store, "2026-10-26", "2026-10-26", null, new Date("2026-10-27T12:00:00Z"));

    expect(response?.data.series.map(({ code }) => code)).toEqual(codes);
    expect(response?.data.series.map(({ points }) => points[0])).toEqual(codes.map((_, index) => ({ date: "2026-10-26", close: 100 + index })));
    expect(response?.data.coverage?.map(({ code, count }) => ({ code, count }))).toEqual(codes.map((code) => ({ code, count: 1 })));
  });
});

describe("serveMarketBrokerSummary", () => {
  it("returns ranked market-wide broker totals per date within the requested range", async () => {
    const rows = [
      { date: "2026-08-07", brokerCode: "AD", firmName: "A", volume: 1, value: 20, frequency: 2, source: "idx-primary", asOf: new Date() },
      { date: "2026-08-07", brokerCode: "YP", firmName: "Y", volume: 2, value: 50, frequency: 3, source: "idx-primary", asOf: new Date() },
      { date: "2026-08-06", brokerCode: "CC", firmName: "C", volume: 3, value: 10, frequency: 4, source: "idx-primary", asOf: new Date() },
    ];
    const store = {
      latestBrokerSummaryDate: async () => "2026-08-07",
      brokerDailySummaryBetween: async (from: string, to: string) => rows.filter((row) => row.date >= from && row.date <= to),
    } as unknown as MarketStore;
    const response = await serveMarketBrokerSummary(store, "2026-08-07", "2026-08-07", 1, new Date("2026-08-10T12:00:00Z"));
    expect(response?.data.dates).toEqual([{ date: "2026-08-07", brokers: [{ code: "YP", name: "Y", volume: 2, value: 50, frequency: 3 }] }]);
  });
});
