import { expect, test } from "vitest";
import { rankMovers, type Mover } from "./movers";

const m = (symbol: string, changePercent: number | null, valueIdr: number | null): Mover => ({ symbol, name: symbol, close: 100, changePercent, volumeShares: 1, valueIdr, frequency: 1 });
const rows = [m("A", 10, 5e9), m("B", 30, 1e6), m("C", -4, 2e9), m("D", null, 9e9), m("E", 2, null), m("F", 0, 3e9)];

test("gainers/losers exclude illiquid and unchanged rows; active ranks by value", () => {
  expect(rankMovers(rows, "gainers").map((row) => row.symbol)).toEqual(["A"]);
  expect(rankMovers(rows, "losers").map((row) => row.symbol)).toEqual(["C"]);
  expect(rankMovers(rows, "active").map((row) => row.symbol)).toEqual(["D", "A", "F", "C", "B"]);
});
