import { expect, test } from "vitest";
import { countdown, dayDiff, dayKey, groupByDay, isThisWeek, monogram, outletHost, relativeAge, relativeDay, todayWib, weekDays } from "./feed";

test("dayKey reads dates and timestamps", () => {
  expect(dayKey("2026-10-26")).toBe("2026-10-26");
  expect(dayKey("2026-10-26 09:15:00")).toBe("2026-10-26");
  expect(dayKey(null)).toBeNull();
  expect(dayKey("garbage")).toBeNull();
});

test("todayWib uses the WIB calendar", () => {
  expect(todayWib(Date.parse("2026-10-25T18:00:00Z"))).toBe("2026-10-26");
});

test("groupByDay orders days and puts undated last", () => {
  const items = [{ d: "2026-10-25" }, { d: "2026-10-26" }, { d: null }, { d: "2026-10-25" }];
  const groups = groupByDay(items, (i) => i.d);
  expect(groups.map((g) => g.day)).toEqual(["2026-10-26", "2026-10-25", null]);
  expect(groups[1].items).toHaveLength(2);
  expect(groupByDay(items, (i) => i.d, "asc").map((g) => g.day)).toEqual(["2026-10-25", "2026-10-26", null]);
});

test("relativeDay and countdown", () => {
  expect(relativeDay("2026-10-26", "2026-10-26").kind).toBe("today");
  expect(relativeDay("2026-10-25", "2026-10-26").kind).toBe("yesterday");
  expect(relativeDay("2026-10-27", "2026-10-26").kind).toBe("tomorrow");
  expect(relativeDay("2026-10-10", "2026-10-26").kind).toBe("date");
  expect(countdown("2026-10-29", "2026-10-26")).toEqual({ kind: "in", days: 3 });
  expect(countdown("2026-10-24", "2026-10-26")).toEqual({ kind: "ago", days: 2 });
  expect(countdown("2026-10-26", "2026-10-26").kind).toBe("today");
  expect(dayDiff("2026-02-28", "2026-03-01")).toBe(1);
});

test("weeks are Monday-based", () => {
  expect(weekDays("2026-10-28")[0]).toBe("2026-10-26");
  expect(weekDays("2026-10-28")[6]).toBe("2026-11-01");
  expect(isThisWeek("2026-11-01", "2026-10-26")).toBe(true);
  expect(isThisWeek("2026-11-02", "2026-10-26")).toBe(false);
});

test("outlet host and monogram", () => {
  expect(outletHost("https://www.kontan.co.id/a")).toBe("kontan.co.id");
  expect(outletHost("javascript:alert(1)")).toBeNull();
  expect(monogram("kontan.co.id")).toBe("KO");
  expect(monogram(null)).toBe("··");
});

test("relativeAge only for timestamps", () => {
  const now = Date.parse("2026-10-26T05:00:00Z");
  expect(relativeAge("2026-10-26")).toBeNull();
  expect(relativeAge("2026-10-26T04:30:00Z", now)).toEqual({ unit: "minute", value: 30 });
  expect(relativeAge("2026-10-26T02:00:00Z", now)).toEqual({ unit: "hour", value: 3 });
  expect(relativeAge("2026-10-23T05:00:00Z", now)).toEqual({ unit: "day", value: 3 });
  expect(relativeAge("2026-10-27T05:00:00Z", now)).toBeNull();
});
