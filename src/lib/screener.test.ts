import { expect, test } from "vitest";
import { conditionsValid, FIELD_FORMAT, resultFields } from "./screener";

test("validity and result columns", () => {
  expect(conditionsValid([])).toBe(false);
  expect(conditionsValid([{ field: "per", operator: "LT", value: Number.NaN, connective: "AND" }])).toBe(false);
  expect(conditionsValid([{ field: "per", operator: "LT", value: 15, connective: "AND" }])).toBe(true);
  expect(resultFields([{ field: "per", operator: "LT", value: 15, connective: "AND" }, { field: "value", operator: "GT", value: 1, connective: "AND" }])).toEqual(["price", "change1D", "value", "volume", "per"]);
});

test("ratio fields measured as fractions use the percent display format", () => {
  expect(FIELD_FORMAT).toMatchObject({ roe: "percent", roa: "percent", dividendYield: "percent" });
});
