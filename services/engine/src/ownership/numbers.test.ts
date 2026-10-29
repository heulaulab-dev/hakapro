import { describe, expect, it } from "vitest";
import { isMonth, nextMonth, parseListDate, parsePercent, parseShares, previousMonth } from "./numbers";

describe("parseShares", () => {
  it.each([
    ["3.200.142.830", "3200142830"],
    ["3,200,142,830", "3200142830"],
    ["3200142830", "3200142830"],
    [" 3.200.142.830 ", "3200142830"],
    ["3 200 142 830", "3200142830"],
    ["3.200.142.830,00", "3200142830"],
    ["3,200,142,830.00", "3200142830"],
    ["1.000", "1000"],
    ["0", "0"],
    ["007", "7"],
    ["123456789012345678901234", "123456789012345678901234"],
  ])("%s → %s", (raw, expected) => expect(parseShares(raw)).toBe(expected));

  it.each(["", " ", "-", "–"])("blank %j → null", (raw) => expect(parseShares(raw)).toBeNull());

  it.each([
    ["12.34.56", /unreadable/],
    ["1.234,5", /fraction/],
    ["1.5", /fraction/],
    ["1.234.567,89", /fraction/],
    ["1,234.567", /unreadable/],
    ["1.23.456", /unreadable/],
    ["-5.000", /negative/],
    ["(5.000)", /negative/],
    ["abc", /unreadable/],
    ["1234567890123456789012345", /too large/],
  ])("rejects %s", (raw, message) => expect(() => parseShares(raw)).toThrow(message));
});

describe("parsePercent", () => {
  it("normalizes XLSX floating-point artifacts", () => {
    expect(parsePercent("1.1500000000000001")).toBe("1.15");
    expect(parsePercent("54.94000000000001")).toBe("54.94");
  });

  it("rounds official KSEI percentages to the database's six-decimal scale", () => {
    expect(parsePercent("36.10840509074754")).toBe("36.108405");
    expect(parsePercent("99.9999999")).toBe("100");
  });

  it.each([
    ["41,10", "41.1"],
    ["41.10", "41.1"],
    ["41,10%", "41.1"],
    ["41,10 %", "41.1"],
    ["0,9", "0.9"],
    ["5", "5"],
    ["100", "100"],
    ["100,00", "100"],
    ["1,000001", "1.000001"],
    ["05,50", "5.5"],
    [".5", null],
  ])("%s → %s", (raw, expected) => {
    if (expected === null) expect(() => parsePercent(raw)).toThrow();
    else expect(parsePercent(raw)).toBe(expected);
  });

  it("returns null for a blank cell", () => expect(parsePercent(" - ")).toBeNull());

  it.each([
    ["100,01", /above 100/],
    ["101", /above 100/],
    ["1.000,00", /above 100/],
    ["1,2,3", /unreadable/],
    ["-1,5", /negative/],
    ["n/a", /unreadable/],
  ])("rejects %s", (raw, message) => expect(() => parsePercent(raw)).toThrow(message));
});

describe("parseListDate", () => {
  it.each([
    ["27-Feb-2026", "2026-02-27"],
    ["27-Feb-26", "2026-02-27"],
    ["27 Februari 2026", "2026-02-27"],
    ["31-Mei-2026", "2026-05-31"],
    ["29-Agu-2026", "2026-08-29"],
    ["30-Okt-2026", "2026-10-30"],
    ["31-Des-2026", "2026-12-31"],
    ["2026-02-27", "2026-02-27"],
    ["27/02/2026", "2026-02-27"],
    ["7.3.2026", "2026-03-07"],
  ])("%s → %s", (raw, expected) => expect(parseListDate(raw)).toBe(expected));

  it.each([
    ["31-Feb-2026", /not a calendar date/],
    ["2026-13-01", /not a calendar date/],
    ["27-Foo-2026", /unknown month/],
    ["Feb 2026", /unreadable/],
  ])("rejects %s", (raw, message) => expect(() => parseListDate(raw)).toThrow(message));
});

describe("months", () => {
  it("validates and steps months", () => {
    expect(isMonth("2026-02")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-03")).toBe("2026-02");
    expect(nextMonth("2026-12")).toBe("2027-01");
  });
});
