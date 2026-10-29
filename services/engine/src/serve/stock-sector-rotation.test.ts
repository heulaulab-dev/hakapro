import { describe, expect, it } from "vitest";
import { buildPeerBasket, rankLiquidIssuers, serveStockSectorRotation } from "./stock-sector-rotation";
import { MemoryMarketStore } from "./store";

const row = (symbol: string, date: string, close: number, value = 100) => ({ symbol, date, close, value });

describe("stock-to-sector rotation helpers", () => {
  it("builds a leave-one-out equally weighted peer basket", () => {
    const dates = ["2026-10-01", "2026-10-02"];
    const rows = [
      row("AAA", dates[0], 100), row("BBB", dates[0], 100), row("CCC", dates[0], 100), row("DDD", dates[0], 100),
      row("AAA", dates[1], 200), row("BBB", dates[1], 120), row("CCC", dates[1], 90), row("DDD", dates[1], 100),
    ];
    const basket = buildPeerBasket("AAA", ["AAA", "BBB", "CCC", "DDD"], dates, rows);
    expect(basket.peers).toBe(3);
    expect(basket.minPeers).toBe(2);
    expect(basket.series.at(-1)!.close).toBeCloseTo(103.333333, 5);
  });

  it("keeps a gap when fewer than the minimum exact-date peer pairs exist", () => {
    const dates = ["2026-10-01", "2026-10-02", "2026-10-05"];
    const rows = [
      row("AAA", dates[0], 100), row("BBB", dates[0], 100), row("CCC", dates[0], 100), row("DDD", dates[0], 100),
      row("AAA", dates[1], 110), row("BBB", dates[1], 110),
      row("AAA", dates[2], 120), row("BBB", dates[2], 120), row("CCC", dates[2], 90), row("DDD", dates[2], 100),
    ];
    const basket = buildPeerBasket("AAA", ["AAA", "BBB", "CCC", "DDD"], dates, rows);
    expect(basket.series[1]).toEqual({ date: dates[1], close: null });
    expect(basket.validIntervals).toBe(1);
    expect(basket.coveragePercent).toBe(50);
  });

  it("ranks eligible issuers by mean traded value with stable symbol tie-break", () => {
    const rows = [
      row("BBB", "2026-10-01", 10, 200), row("BBB", "2026-10-02", 10, 200),
      row("AAA", "2026-10-01", 10, 200), row("AAA", "2026-10-02", 10, 200),
      row("CCC", "2026-10-01", 10, 500),
    ];
    expect(rankLiquidIssuers(["AAA", "BBB", "CCC"], rows, 2, 2)).toEqual([
      { symbol: "AAA", meanValue: 200 }, { symbol: "BBB", meanValue: 200 },
    ]);
  });

  it("serves a sector cohort with exact aligned observations and bounded RRG tails", async () => {
    const securities = ["AAA", "BBB", "CCC", "DDD"].map((symbol) => ({
      symbol, name: `${symbol} Inc`, sector: "Energy", subsector: null, board: "Main", sharesOutstanding: null, freeFloatPct: null,
      asOf: new Date("2026-10-01T00:00:00Z"), active: true,
    }));
    const daily = Array.from({ length: 80 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
      return securities.map(({ symbol }) => ({
        symbol, date,
        close: 100 + index * ({ AAA: 1.2, BBB: 0.7, CCC: 0.4, DDD: 0.9 }[symbol as "AAA" | "BBB" | "CCC" | "DDD"]!) + Math.sin(index / ({ AAA: 3, BBB: 5, CCC: 7, DDD: 4 }[symbol as "AAA" | "BBB" | "CCC" | "DDD"]!)) * 5,
        open: null, high: null, low: null, previousClose: null, volume: null, value: 1_000_000 + index, frequency: null, foreignBuy: null, foreignSell: null,
      }));
    }).flat();
    const store = new MemoryMarketStore({ securities, daily });
    const result = await serveStockSectorRotation(store, "all", "daily", new Date("2026-10-01T00:00:00Z"));
    expect(result?.data.sector).toBe("Energy");
    expect(result?.data.universe).toMatchObject({ activeMembers: 4, eligibleIssuers: 4, returnedIssuers: 4, truncated: false });
    expect(result?.data.minPeerConstituents).toBe(2);
    expect(result?.data.stocks[0]).toMatchObject({ peers: 3, basketCoveragePercent: 100 });
    expect(result?.data.stocks[0]?.alignedObservations).toBeGreaterThanOrEqual(34);
    expect(result?.data.stocks[0]?.points.length).toBeLessThanOrEqual(12);
    expect(result?.data.stocks[0]?.latest).not.toBeNull();
  });

  it("does not calculate a continuous RRG across a missing-session gap", async () => {
    const securities = ["AAA", "BBB", "CCC", "DDD"].map((symbol) => ({
      symbol, name: `${symbol} Inc`, sector: "Energy", subsector: null, board: "Main", sharesOutstanding: null, freeFloatPct: null,
      asOf: new Date("2026-10-01T00:00:00Z"), active: true,
    }));
    const other = { symbol: "ZZZ", name: "Other Inc", sector: "Other", subsector: null, board: "Main", sharesOutstanding: null, freeFloatPct: null, asOf: new Date("2026-10-01T00:00:00Z"), active: true };
    const daily = Array.from({ length: 80 }, (_, index) => {
      const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
      if (index === 60) return [{ symbol: "ZZZ", date, close: 10, open: null, high: null, low: null, previousClose: null, volume: null, value: 1_000_000, frequency: null, foreignBuy: null, foreignSell: null }];
      return securities.map(({ symbol }, symbolIndex) => ({
        symbol, date, close: 100 + index * (symbolIndex + 1) + Math.sin(index / (symbolIndex + 2)) * 3,
        open: null, high: null, low: null, previousClose: null, volume: null, value: 1_000_000, frequency: null, foreignBuy: null, foreignSell: null,
      }));
    }).flat();
    const result = await serveStockSectorRotation(new MemoryMarketStore({ securities: [...securities, other], daily }), "Energy", "daily", new Date("2026-10-01T00:00:00Z"));
    expect(result?.data.stocks[0]?.alignedObservations).toBe(19);
    expect(result?.data.stocks[0]?.latest).toBeNull();
    expect(result?.data.stocks[0]?.points).toEqual([]);
  });
});
