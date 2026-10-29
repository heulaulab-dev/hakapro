import { describe, expect, it } from "vitest";
import { serveBreadth, serveBreadthHistory } from "./breadth";
import { MemoryMarketStore } from "./store";

describe("market breadth", () => {
  it("classifies strong participation as risk on", async () => {
    const result = await serveBreadth(new MemoryMarketStore({ daily: [
      { symbol: "A", date: "2026-10-28", close: 110, previousClose: 100, open: null, high: null, low: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
      { symbol: "B", date: "2026-10-28", close: 120, previousClose: 100, open: null, high: null, low: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
      { symbol: "C", date: "2026-10-28", close: 90, previousClose: 100, open: null, high: null, low: null, volume: null, value: null, frequency: null, foreignBuy: null, foreignSell: null },
    ] }), new Date("2026-10-29T00:00:00Z"));
    expect(result.data).toMatchObject({ advancers: 2, decliners: 1, unchanged: 0, regime: "RISK_ON", snapshotDate: "2026-10-28" });
  });
  it("does not fabricate a regime without a session", async () => {
    const result = await serveBreadth(new MemoryMarketStore(), new Date("2026-10-29T00:00:00Z"));
    expect(result.data.regime).toBe("UNAVAILABLE");
    expect(result.freshness).toBe("UNAVAILABLE");
  });
});

describe("market breadth history", () => {
  const dateAt = (index: number) => {
    const date = new Date(Date.UTC(2026, 7, 1 + index));
    return date.toISOString().slice(0, 10);
  };
  const row = (symbol: string, date: string, close: number, value: number | null = 1000, previousClose: number | null = null) => ({
    symbol, date, close, previousClose, open: null, high: null, low: null, volume: null, value, frequency: null, foreignBuy: null, foreignSell: null,
  });

  it("calculates normalized breadth pressure, SMA participation and directional traded value with coverage", async () => {
    const daily = Array.from({ length: 40 }, (_, i) => {
      const date = dateAt(i);
      const final = i === 39;
      return [
        row("AAA", date, final ? 110 : 100, 1000),
        row("BBB", date, final ? 90 : 100, 500),
        ...(i >= 38 ? [row("CCC", date, final ? 110 : 100, 1500)] : []),
        ...(final ? [row("NEW", date, 50, null)] : []),
      ];
    }).flat();

    const result = await serveBreadthHistory(new MemoryMarketStore({ daily }), "1M", new Date("2026-10-30T00:00:00Z"));
    const latest = result.data.series.at(-1)!;

    expect(result.data.series).toHaveLength(21);
    expect(latest).toMatchObject({
      advancers: 2, decliners: 1, unchanged: 0, comparable: 3, observed: 4,
      netAdvanceRate: 1 / 3, aboveSma20Eligible: 2, aboveSma20Pct: 0.5,
      advancingValueIdr: 2500, decliningValueIdr: 500, valueObserved: 3, valueCoverage: 3 / 4,
      advancingValueShare: 5 / 6,
    });
    expect(latest.cumulativePressure).toBeCloseTo(100 / 3, 10);
    expect(result.data.snapshotDate).toBe(dateAt(39));
  });

  it("bounds every requested history window and returns unavailable for an empty store", async () => {
    const empty = await serveBreadthHistory(new MemoryMarketStore(), "1Y", new Date("2026-10-30T00:00:00Z"));
    expect(empty.data).toMatchObject({ window: "1Y", source: "none", freshness: "UNAVAILABLE", snapshotDate: null, series: [] });

    const daily = Array.from({ length: 310 }, (_, i) => row("AAA", dateAt(i), 100));
    const year = await serveBreadthHistory(new MemoryMarketStore({ daily }), "1Y", new Date("2026-10-30T00:00:00Z"));
    expect(year.data.series).toHaveLength(252);
    expect(year.data.series[0].date).toBe(dateAt(58));
  });
});
