// Ported from heulatrade tests/{alerts,indicators,portfolio}.test.ts.
import { describe, expect, it, test } from "vitest";
import type { Candle, Quote } from "@/server/market/types";
import { foreignNet, observedMetric, triggered } from "./alerts";
import { calculateMacd, calculateSimpleMovingAverage } from "@/lib/indicators";
import { calculatePortfolio } from "./portfolio";

const quote: Quote = { symbol: "BBCA", date: "2026-09-21", open: null, high: null, low: null, close: 9100, previousClose: 9000, change: 100, changePercent: (100 / 9000) * 100, volumeShares: 100, valueIdr: null, frequency: null, foreignBuyShares: null, foreignSellShares: null };
const latest: Candle = { date: "2026-09-21", open: null, high: null, low: null, close: 9100, volumeShares: 100, foreignBuyShares: 50, foreignSellShares: 30 };

describe("EOD alert evaluation", () => {
  it("uses percent units for daily change and shares for foreign net", () => {
    expect(observedMetric("DAILY_CHANGE", quote, [latest])).toBeCloseTo(1.1111, 3);
    expect(observedMetric("FOREIGN_NET", quote, [latest])).toBe(20);
    expect(triggered({ metric: "DAILY_CHANGE", operator: "GT", threshold: 1 }, 1.1111)).toBe(true);
  });
  it("requires all 20 preceding sessions for a volume ratio", () => {
    expect(observedMetric("VOLUME_RATIO_20D", quote, [latest])).toBeNull();
    const previous = Array.from({ length: 20 }, (_, index): Candle => ({ ...latest, date: `2026-08-${String(index + 1).padStart(2, "0")}`, volumeShares: 50 }));
    expect(observedMetric("VOLUME_RATIO_20D", quote, [...previous, latest])).toBe(2);
    expect(observedMetric("VOLUME_RATIO_20D", quote, [...previous.slice(1), { ...previous[0], volumeShares: null }, latest])).toBeNull();
  });
  it("never treats missing data as zero", () => {
    expect(foreignNet(null, 30)).toBeNull();
    expect(observedMetric("FOREIGN_NET", quote, [{ ...latest, foreignBuyShares: null }])).toBeNull();
    expect(triggered({ metric: "PRICE", operator: "LT", threshold: 1 }, null)).toBe(false);
    expect(triggered({ metric: "PRICE", operator: "GTE", threshold: 0 }, 0)).toBe(true);
  });
});

describe("indicators", () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({ time: `2026-01-${String(index + 1).padStart(2, "0")}`, close: index + 1 }));
  test("SMA only after enough finite samples", () => {
    expect(calculateSimpleMovingAverage(rows, 5)[0]).toEqual({ time: rows[4].time, value: 3 });
    expect(calculateSimpleMovingAverage(rows.slice(0, 4), 5)).toEqual([]);
  });
  test("MACD finite and omits insufficient samples", () => {
    const macd = calculateMacd(rows);
    expect(macd.length).toBeGreaterThan(0);
    expect(macd.every((point) => [point.macd, point.signal, point.histogram].every(Number.isFinite))).toBe(true);
    expect(calculateMacd(rows.slice(0, 20))).toEqual([]);
  });
});

describe("transaction-derived portfolio", () => {
  it("uses cost basis for realized P/L", () => {
    const result = calculatePortfolio([
      { symbol: "BBCA", transaction_type: "BUY", transaction_date: "2026-01-01", quantity: 100, price: 9000, fees: 1000, cash_amount: null },
      { symbol: "BBCA", transaction_type: "SELL", transaction_date: "2026-02-01", quantity: 40, price: 9500, fees: 1000, cash_amount: null },
    ]);
    expect(result.positions[0].quantity).toBe(60);
    expect(result.positions[0].costBasis).toBe(540600);
    expect(result.realizedPnL).toBe(18600);
  });
  it("rejects a sale larger than the position", () => {
    expect(() => calculatePortfolio([{ symbol: "BBCA", transaction_type: "SELL", transaction_date: "2026-01-01", quantity: 1, price: 9000, fees: 0, cash_amount: null }])).toThrow("exceeds");
  });
});
