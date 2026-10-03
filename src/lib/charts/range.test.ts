import { expect, test } from "vitest";
import { sliceByRange } from "./range";

test("keeps the most recent sessions and flags short data", () => {
  const rows = Array.from({ length: 120 }, (_, index) => index);
  expect(sliceByRange(rows, "1M")).toEqual({ rows: rows.slice(-21), limited: false });
  expect(sliceByRange(rows, "6M").limited).toBe(true);
  expect(sliceByRange(rows, "1Y").rows).toHaveLength(120);
});
