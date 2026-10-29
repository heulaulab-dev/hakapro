import { describe, expect, test } from "vitest";
import { formatBytes, formatMonthName, formatShortDate, direction, EMPTY, formatChange, formatCompact, formatDate, formatIdr, formatNumber, formatPercent, formatPeriod, formatVolume } from "./index";

describe("abbreviation collision (init prompt §6)", () => {
  test("1.5e12 → Rp1,5 T (id) and Rp1.5T (en)", () => {
    expect(formatIdr(1.5e12, "id", { compact: true })).toBe("Rp1,5 T");
    expect(formatIdr(1.5e12, "en", { compact: true })).toBe("Rp1.5T");
  });

  test("10^9 is M (miliar) in id but B in en; 10^6 is jt in id but M in en", () => {
    expect(formatCompact(2.5e9, "id")).toBe("2,5 M");
    expect(formatCompact(2.5e9, "en")).toBe("2.5B");
    expect(formatCompact(2.5e6, "id")).toBe("2,5 jt");
    expect(formatCompact(2.5e6, "en")).toBe("2.5M");
    expect(formatCompact(2_500, "id")).toBe("2,5 rb");
    expect(formatCompact(2_500, "en")).toBe("2.5K");
  });

  test("recorded BBCA market cap and listed shares", () => {
    expect(formatIdr(768866486850000, "id", { compact: true })).toBe("Rp768,87 T");
    expect(formatIdr(768866486850000, "en", { compact: true })).toBe("Rp768.87T");
    expect(formatCompact(122042299500, "id")).toBe("122,04 M");
    expect(formatCompact(122042299500, "en")).toBe("122.04B");
  });

  test("rounding promotes to the next unit instead of showing 1.000 rb", () => {
    expect(formatCompact(999_999, "id")).toBe("1 jt");
    expect(formatCompact(999_999, "en")).toBe("1M");
    expect(formatCompact(999.999, "en")).toBe("1K");
  });

  test("small values are shown in full", () => {
    expect(formatCompact(950, "id")).toBe("950");
    expect(formatCompact(0, "en")).toBe("0");
  });
});

describe("separators", () => {
  test("id uses . for thousands and , for decimals; en the reverse", () => {
    expect(formatNumber(1234567.89, "id")).toBe("1.234.567,89");
    expect(formatNumber(1234567.89, "en")).toBe("1,234,567.89");
  });

  test("prices in full with Rp prefix", () => {
    expect(formatIdr(6300, "id")).toBe("Rp6.300");
    expect(formatIdr(6300, "en")).toBe("Rp6,300");
    expect(formatIdr(-38389192500, "id", { compact: true })).toBe("-Rp38,39 M");
    expect(formatIdr(-38389192500, "en", { compact: true })).toBe("-Rp38.39B");
  });
});

describe("percent and change carry an explicit sign", () => {
  test("percent units in", () => {
    expect(formatPercent(1.25, "id")).toBe("+1,25%");
    expect(formatPercent(-0.8, "id")).toBe("-0,80%");
    expect(formatPercent(1.25, "en")).toBe("+1.25%");
    expect(formatPercent(-0.79, "en")).toBe("-0.79%");
    expect(formatPercent(0, "en")).toBe("0.00%");
    expect(formatPercent(-0.001, "id")).toBe("0,00%");
    expect(formatPercent(0.0061, "id", { decimals: 4, signed: false })).toBe("0,0061%");
  });

  test("absolute change", () => {
    expect(formatChange(-50, "id")).toBe("-50");
    expect(formatChange(1250, "id")).toBe("+1.250");
    expect(formatChange(0, "en")).toBe("0");
  });
});

describe("volume units are always labelled", () => {
  test("shares and lots (1 lot = 100 shares)", () => {
    expect(formatVolume(177_000_000, "id", { compact: true })).toBe("177 jt lembar");
    expect(formatVolume(177_000_000, "en", { compact: true })).toBe("177M shares");
    expect(formatVolume(1_234_500, "id", { unit: "lots" })).toBe("12.345 lot");
    expect(formatVolume(1_234_500, "en", { unit: "lots" })).toBe("12,345 lots");
    expect(formatVolume(100, "en", { unit: "lots" })).toBe("1 lot");
    expect(formatVolume(64, "en", { unit: "lots" })).toBe("0.64 lots");
  });
});

test("signed net volume and short dates", () => {
  expect(formatVolume(34_080_000, "en", { compact: true, signed: true })).toBe("+34.08M shares");
  expect(formatVolume(-56_760_000, "id", { compact: true, signed: true })).toBe("-56,76 jt lembar");
  expect(formatShortDate("2026-06-24", "en")).toBe("Jun 24");
  expect(formatShortDate("2026-06-24", "id")).toBe("24 Jun");
  expect(formatMonthName(5, "id")).toBe("Mei");
  expect(formatMonthName(5, "en")).toBe("May");
  expect(formatMonthName(13, "en")).toBe("—");
});

describe("dates", () => {
  test("date-only, month-only and timestamps (WIB)", () => {
    expect(formatDate("2026-09-18", "id")).toBe("18 Sep 2026");
    expect(formatDate("2026-09-18", "en")).toBe("Sep 18, 2026");
    expect(formatDate("2026-09", "id")).toBe("Sep 2026");
    expect(formatDate("2026-09-13 18:06:34", "id")).toBe("13 Sep 2026 18.06 WIB");
    expect(formatDate("2026-09-18T09:00:00Z", "en")).toBe("Sep 18, 2026, 16:00 WIB");
  });

  test("period ranges", () => {
    expect(formatPeriod("2020-01/2026-09", "id")).toBe("Jan 2020 – Sep 2026");
    expect(formatPeriod("Q1 2026", "en")).toBe("Q1 2026");
  });
});

test("missing values never become zero", () => {
  for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(formatNumber(value, "id")).toBe(EMPTY);
    expect(formatIdr(value, "en")).toBe(EMPTY);
    expect(formatPercent(value, "id")).toBe(EMPTY);
    expect(formatVolume(value, "en")).toBe(EMPTY);
    expect(direction(value)).toBe("neutral");
  }
  expect(formatDate("not a date", "id")).toBe(EMPTY);
});

test("formatBytes steps by 1024 with locale decimals", () => {
  expect(formatBytes(512, "en")).toBe("512 B");
  expect(formatBytes(1536, "en")).toBe("1.5 KB");
  expect(formatBytes(1536, "id")).toBe("1,5 KB");
  expect(formatBytes(5 * 1024 * 1024, "en")).toBe("5 MB");
  expect(formatBytes(-1, "en")).toBe(EMPTY);
  expect(formatBytes(null, "en")).toBe(EMPTY);
});
