import { describe, expect, test } from "vitest";
import { headerStats } from "./stock-header";

const row = { valueIdr: 1_110_000_000_000, volumeShares: 176_750_000, foreignNetShares: -56_760_000, low: 6225, high: 6350 };

describe("headerStats", () => {
  test("uses the daily row when the price is the history's close", () => {
    expect(headerStats(row, { lots: 5, valueIdr: 10 }, false)).toEqual(row);
  });

  test("uses today's quote (lots become shares) when the price comes from it, with no foreign net or range", () => {
    expect(headerStats(row, { lots: 1_500, valueIdr: 9_000_000_000 }, true)).toEqual({ valueIdr: 9_000_000_000, volumeShares: 150_000, foreignNetShares: null, low: null, high: null });
  });

  test("falls back to the daily row when the price is flagged from the quote but none was fetched", () => {
    expect(headerStats(row, undefined, true)).toEqual(row);
  });

  test("returns nulls, never zeros, without data", () => {
    expect(headerStats(null, null, false)).toEqual({ valueIdr: null, volumeShares: null, foreignNetShares: null, low: null, high: null });
  });
});
