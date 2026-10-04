import { describe, expect, test } from "vitest";
import { mergeLastPrice, type DailyClose } from "./last-price";

const rows: DailyClose[] = [
  { date: "2026-10-01", close: 6000, change: -50, changePercent: -0.83 },
  { date: "2026-10-02", close: 6100, change: 100, changePercent: 1.67 },
];

describe("mergeLastPrice", () => {
  test("no price (or no session) keeps the daily close", () => {
    expect(mergeLastPrice(rows, null)).toEqual({ ...rows[1], fromPrice: false });
    expect(mergeLastPrice(rows, { sessionDate: null, lastPriceIdr: 6200 })).toEqual({ ...rows[1], fromPrice: false });
  });

  test("today's price on the next trading day is measured against the latest close", () => {
    // 2026-10-05 is the Monday after Friday 2026-10-02.
    expect(mergeLastPrice(rows, { sessionDate: "2026-10-05", lastPriceIdr: 6222 })).toEqual({ date: "2026-10-05", close: 6222, change: 122, changePercent: 2, fromPrice: true });
  });

  test("a price for the history's latest session is measured against the session before", () => {
    expect(mergeLastPrice(rows, { sessionDate: "2026-10-02", lastPriceIdr: 6100 })).toEqual({ date: "2026-10-02", close: 6100, change: 100, changePercent: 1.67, fromPrice: true });
  });

  test("a gap in the history gives no change rather than a multi-session one", () => {
    expect(mergeLastPrice(rows, { sessionDate: "2026-10-08", lastPriceIdr: 6300 })).toEqual({ date: "2026-10-08", close: 6300, change: null, changePercent: null, fromPrice: true });
  });

  test("an older price never replaces newer history", () => {
    expect(mergeLastPrice(rows, { sessionDate: "2026-09-30", lastPriceIdr: 1 })).toEqual({ ...rows[1], fromPrice: false });
  });
});
