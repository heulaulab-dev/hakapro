import { describe, expect, it } from "vitest";
import { deriveDividendPatterns } from "./dividend-patterns";

const date = (offset: number) => {
  const day = new Date("2026-01-01T00:00:00Z");
  day.setUTCDate(day.getUTCDate() + offset);
  return day.toISOString().slice(0, 10);
};

const prices = Array.from({ length: 400 }, (_, index) => ({
  date: date(index), close: index === 340 || index === 365 ? 95 : 100, value: 2_000_000_000,
}));
const dividends = [{ exDate: date(340), amount: 5 }, { exDate: date(365), amount: 5 }];

describe("dividend patterns from stored closes and cash dividends", () => {
  it("measures run-up, ex-date drop, recovery, held-through return, yield and patterns", () => {
    const result = deriveDividendPatterns(prices, dividends);
    if (!result) throw new Error("expected dividend data");
    expect(result.history).toHaveLength(2);
    expect(result.history[0]).toMatchObject({ cumDate: date(339), runUpPercent: 0, exDropPercentOfDividend: 100, recoverySessions: 2, heldThroughExPercent: 0 });
    expect(result.medians).toMatchObject({ runUpPercent: 0, exDropPercentOfDividend: 100, recoverySessions: 2 });
    expect(result.yield).toMatchObject({ trailing: 0.1, ahead: 0.1, selected: 0.1 });
    expect(result.projections).toHaveLength(2);
    expect(result.patterns).toEqual({ lowTrapRisk: true, capture: true, runUp: false, highYield: true });
  });

  it("does not classify an illiquid stock even when its historical pattern qualifies", () => {
    const result = deriveDividendPatterns(prices.map((row) => ({ ...row, value: 500_000_000 })), dividends);
    if (!result) throw new Error("expected dividend data");
    expect(result.liquidityEligible).toBe(false);
    expect(Object.values(result.patterns)).toEqual([false, false, false, false]);
  });

  it("suppresses an anniversary projection once an actual dividend falls within 60 days", () => {
    const future = { exDate: date(200 + 364 - 10), amount: 6 };
    const result = deriveDividendPatterns(prices, [{ exDate: date(200), amount: 5 }, dividends[1], future]);
    if (!result) throw new Error("expected dividend data");
    expect(result.projections.map((row) => row.basedOnExDate)).not.toContain(date(200));
    expect(result.projections.map((row) => row.basedOnExDate)).toContain(date(365));
  });
});
