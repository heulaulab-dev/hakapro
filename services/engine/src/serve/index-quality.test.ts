import { describe, expect, it } from "vitest";
import { indexCoverage, indexCoverageReport, tradingDaysBetween, type IndexSeriesInput } from "./index-quality";

// A hermetic "weekdays are trading days" calendar — no holiday table, so the arithmetic is hand-verifiable.
const isWeekday = (iso: string): boolean => {
  const day = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
};

describe("tradingDaysBetween", () => {
  it("counts weekdays inclusive and returns 0 for an inverted range", () => {
    // 2026-01-05 (Mon) .. 2026-01-09 (Fri) = 5 weekdays.
    expect(tradingDaysBetween("2026-01-05", "2026-01-09", isWeekday)).toBe(5);
    // 2026-01-05 (Mon) .. 2026-01-12 (next Mon) = 6 weekdays (Sat/Sun skipped).
    expect(tradingDaysBetween("2026-01-05", "2026-01-12", isWeekday)).toBe(6);
    expect(tradingDaysBetween("2026-01-09", "2026-01-05", isWeekday)).toBe(0);
  });
});

describe("indexCoverage", () => {
  const series = (points: { date: string; close: number }[]): IndexSeriesInput => ({ code: "IDXENERGY", name: "Energy", points });

  it("reports an empty series without flags", () => {
    const c = indexCoverage(series([]), "2026-01-12", isWeekday);
    expect(c).toEqual({ code: "IDXENERGY", name: "Energy", count: 0, firstDate: null, lastDate: null, spanTradingDays: 0, missingSessions: 0, staleTradingDays: 0, flags: [] });
  });

  it("computes span and missing sessions for a complete week, fresh", () => {
    // Mon..Fri, all five sessions present; today is Friday → not stale.
    const c = indexCoverage(series([
      { date: "2026-01-05", close: 100 }, { date: "2026-01-06", close: 101 }, { date: "2026-01-07", close: 102 },
      { date: "2026-01-08", close: 103 }, { date: "2026-01-09", close: 104 },
    ]), "2026-01-09", isWeekday);
    expect(c.count).toBe(5);
    expect(c.firstDate).toBe("2026-01-05");
    expect(c.lastDate).toBe("2026-01-09");
    expect(c.spanTradingDays).toBe(5);
    expect(c.missingSessions).toBe(0);
    expect(c.staleTradingDays).toBe(0);
    expect(c.flags).toEqual([]);
  });

  it("detects a gap inside the covered span", () => {
    // Mon, Tue, Fri present → span is 5 weekdays but only 3 stored → 2 missing. Today = Fri, fresh.
    const c = indexCoverage(series([
      { date: "2026-01-05", close: 100 }, { date: "2026-01-06", close: 101 }, { date: "2026-01-09", close: 104 },
    ]), "2026-01-09", isWeekday);
    expect(c.spanTradingDays).toBe(5);
    expect(c.count).toBe(3);
    expect(c.missingSessions).toBe(2);
    expect(c.flags).toEqual([]);
  });

  it("flags STALE when no observation for >= 2 trading days", () => {
    // Last = Mon 2026-01-05, today = Thu 2026-01-08 → Tue, Wed, Thu stale (3) → STALE.
    const c = indexCoverage(series([{ date: "2026-01-05", close: 100 }]), "2026-01-08", isWeekday);
    expect(c.staleTradingDays).toBe(3);
    expect(c.flags).toContain("STALE");
  });

  it("does not flag STALE on the normal one-day lag", () => {
    // Last = Mon, today = Tue → 1 stale trading day, under the threshold.
    const c = indexCoverage(series([{ date: "2026-01-05", close: 100 }]), "2026-01-06", isWeekday);
    expect(c.staleTradingDays).toBe(1);
    expect(c.flags).not.toContain("STALE");
  });

  it("flags NON_POSITIVE_CLOSE and UNORDERED", () => {
    const nonPositive = indexCoverage(series([{ date: "2026-01-05", close: 0 }, { date: "2026-01-06", close: -1 }]), "2026-01-06", isWeekday);
    expect(nonPositive.flags).toContain("NON_POSITIVE_CLOSE");
    const unordered = indexCoverage(series([{ date: "2026-01-06", close: 1 }, { date: "2026-01-05", close: 1 }]), "2026-01-06", isWeekday);
    expect(unordered.flags).toContain("UNORDERED");
  });
});

describe("indexCoverageReport", () => {
  it("covers every code", () => {
    const report = indexCoverageReport([
      { code: "COMPOSITE", name: "IDX Composite", points: [{ date: "2026-01-05", close: 7000 }] },
      { code: "IDXENERGY", name: "Energy", points: [] },
    ], "2026-01-05", isWeekday);
    expect(report.map((r) => r.code)).toEqual(["COMPOSITE", "IDXENERGY"]);
    expect(report[1].count).toBe(0);
  });
});
