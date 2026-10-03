import { describe, expect, test } from "vitest";
import { wib } from "../../../tests/support/fixtures";
import { classifySessionDate, previousTradingDay, withFreshness } from "./index";

describe("classifySessionDate (MIGRATION §9.4)", () => {
  // 2026-09-18 is a Friday; 2026-09-21 is the following Monday.
  test("data from the session in progress is DELAYED", () => {
    expect(classifySessionDate("2026-09-18", wib("2026-09-18T10:30:00"))).toBe("DELAYED");
  });

  test("data from the last completed session is EOD", () => {
    expect(classifySessionDate("2026-09-18", wib("2026-09-18T16:30:00"))).toBe("EOD");
    expect(classifySessionDate("2026-09-17", wib("2026-09-18T10:30:00"))).toBe("EOD");
    expect(classifySessionDate("2026-09-18", wib("2026-09-20T12:00:00"))).toBe("EOD"); // Sunday
    expect(classifySessionDate("2026-09-18", wib("2026-09-21T08:00:00"))).toBe("EOD"); // Monday pre-open
  });

  test("anything older than the last completed session is STALE", () => {
    expect(classifySessionDate("2026-09-17", wib("2026-09-18T16:30:00"))).toBe("STALE");
    expect(classifySessionDate("2026-09-18", wib("2026-10-03T12:00:00"))).toBe("STALE");
  });

  test("unparseable, impossible or future dates are UNAVAILABLE", () => {
    const now = wib("2026-09-18T10:30:00");
    for (const value of [null, undefined, "", "Jumat, 18 September 2026", "2026-02-30", "2026-09-19"]) {
      expect(classifySessionDate(value, now)).toBe("UNAVAILABLE");
    }
  });

  test("never returns LIVE for any date/clock combination", () => {
    const clocks = ["2026-09-18T09:00:00", "2026-09-18T12:00:00", "2026-09-18T15:59:00", "2026-09-19T12:00:00"].map(wib);
    const dates = ["2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"];
    for (const now of clocks) for (const date of dates) expect(classifySessionDate(date, now)).not.toBe("LIVE");
  });

  test("timestamps are classified by their date part", () => {
    expect(classifySessionDate("2026-09-18T15:00:00Z", wib("2026-09-18T10:30:00"))).toBe("DELAYED");
  });

  test("previous trading day skips weekends", () => {
    expect(previousTradingDay("2026-09-21")).toBe("2026-09-18");
  });
});

test("withFreshness forces UNAVAILABLE when the as-of date is unknown", () => {
  expect(withFreshness([], { freshness: "EOD", asOf: null, source: "x" }).freshness).toBe("UNAVAILABLE");
  expect(withFreshness([], { freshness: "EOD", asOf: "2026-09-18", source: "x", period: "Q1 2026" })).toEqual({ data: [], freshness: "EOD", asOf: "2026-09-18", source: "x", period: "Q1 2026" });
});
