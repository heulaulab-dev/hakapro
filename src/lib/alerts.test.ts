import { expect, test } from "vitest";
import { validThreshold } from "./alerts";

test("thresholds: non-negative for price/volume/ratio, signed for change and foreign net", () => {
  expect(validThreshold("PRICE", 6300)).toBe(true);
  expect(validThreshold("PRICE", -1)).toBe(false);
  expect(validThreshold("DAILY_CHANGE", -2.5)).toBe(true);
  expect(validThreshold("FOREIGN_NET", -1e6)).toBe(true);
  expect(validThreshold("VOLUME_RATIO_20D", Number.NaN)).toBe(false);
});
