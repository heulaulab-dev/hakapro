import { expect, test } from "vitest";
import { fixture } from "../../../tests/support/fixtures";
import { parseIndonesianDate } from "./screener-date";

test("parses the recorded screener date string", () => {
  expect(parseIndonesianDate(fixture<{ date: string }>("screener").date)).toBe("2026-09-18");
});

test("parses the recorded analysis heading (short month)", () => {
  expect(parseIndonesianDate("📊 **BBCA** — Analisis Jumat, 18 Sep 2026")).toBe("2026-09-18");
});

test.each([["1 Mei 2026", "2026-05-01"], ["31 Desember 2025", "2025-12-31"], ["5 Agu 2026", "2026-08-05"], ["2026-09-18", "2026-09-18"]])("%s → %s", (input, expected) => {
  expect(parseIndonesianDate(input)).toBe(expected);
});

test.each(["SCREENER V5.2", "30 Februari 2026", "18 Foo 2026", ""])("rejects %j", (input) => {
  expect(parseIndonesianDate(input)).toBeNull();
});
