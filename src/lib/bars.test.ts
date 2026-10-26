import { expect, test } from "vitest";
import { barPercent, intensityTier, maxOf, proportions } from "./bars";

test("barPercent scales to the max and guards bad input", () => {
  expect(barPercent(50, 200)).toBe(25);
  expect(barPercent(300, 200)).toBe(100);
  expect(barPercent(null, 200)).toBe(0);
  expect(barPercent(-5, 200)).toBe(0);
  expect(barPercent(5, 0)).toBe(0);
});

test("maxOf ignores nulls", () => {
  expect(maxOf([1, null, 7, undefined, 3])).toBe(7);
  expect(maxOf([])).toBe(0);
});

test("proportions sum to 100", () => {
  expect(proportions([198, 564, 100]).reduce((a, b) => a + b, 0)).toBe(100);
  expect(proportions([0, 0])).toEqual([0, 0]);
  expect(proportions([1, 1, 1]).reduce((a, b) => a + b, 0)).toBe(100);
});

test("intensityTier", () => {
  expect(intensityTier(0)).toBe(0);
  expect(intensityTier(1)).toBe(1);
  expect(intensityTier(-4)).toBe(2);
  expect(intensityTier(25)).toBe(3);
  expect(intensityTier(null)).toBe(0);
});
