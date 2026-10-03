import { expect, test } from "vitest";
import { foreignRangeTotals, rangeStartDate } from "./flow";

test("foreign totals over shown rows", () => {
  expect(foreignRangeTotals([{ foreignNetShares: 10 }, { foreignNetShares: -4 }, { foreignNetShares: 0 }])).toEqual({ sessions: 3, netShares: 6, buySessions: 1, sellSessions: 1 });
  expect(foreignRangeTotals([])).toEqual({ sessions: 0, netShares: 0, buySessions: 0, sellSessions: 0 });
});

test("range start dates", () => {
  expect(rangeStartDate("1M", "2026-09-18")).toBe("2026-08-18");
  expect(rangeStartDate("1Y", "2026-09-18")).toBe("2025-09-17");
});
