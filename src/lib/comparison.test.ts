import { describe, expect, test } from "vitest";
import { normalizeComparisonSeries, normalizeComparisonSymbols } from "./comparison";

describe("normalizeComparisonSeries", () => {
  test("normalizes the first close to 100 and calculates signed return", () => {
    expect(normalizeComparisonSeries([
      { date: "2026-01-02", close: 100 },
      { date: "2026-01-03", close: 110 },
      { date: "2026-01-04", close: 105 },
    ])).toEqual({
      points: [
        { date: "2026-01-02", value: 100 },
        { date: "2026-01-03", value: 110 },
        { date: "2026-01-04", value: 105 },
      ],
      returnPercent: 5,
    });
  });

  test("sorts dates and returns unavailable for insufficient or invalid closes", () => {
    expect(normalizeComparisonSeries([
      { date: "2026-01-03", close: 110 },
      { date: "2026-01-02", close: 100 },
    ])).toMatchObject({ returnPercent: 10 });
    expect(normalizeComparisonSeries([{ date: "2026-01-02", close: 100 }])).toEqual({ points: [], returnPercent: null });
    expect(normalizeComparisonSeries([{ date: "2026-01-02", close: 0 }, { date: "2026-01-03", close: 100 }])).toEqual({ points: [], returnPercent: null });
  });
});

describe("normalizeComparisonSymbols", () => {
  test("deduplicates, uppercases, removes malformed values, and caps at four", () => {
    expect(normalizeComparisonSymbols("bbca, BBCA, br i,BBRI, bmri, tlkm, asii,\nANTM")).toEqual(["BBCA", "BBRI", "BMRI", "TLKM"]);
  });

  test("returns an empty list for absent input", () => {
    expect(normalizeComparisonSymbols(null)).toEqual([]);
  });
});
