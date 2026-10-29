import { describe, expect, test } from "vitest";
import { summarizePortfolio } from "./portfolio";

describe("summarizePortfolio", () => {
  test("tracks weighted buys and sells", () => {
    expect(summarizePortfolio([{ symbol: "BBCA", transactionType: "BUY", quantity: 10, price: 7000, fees: 10 }, { symbol: "BBCA", transactionType: "BUY", quantity: 5, price: 8000, fees: 10 }, { symbol: "BBCA", transactionType: "SELL", quantity: 3, price: 9000, fees: 5 }])).toEqual([{ symbol: "BBCA", quantity: 12, cost: 88016, averagePrice: 7334.666666666667 }]);
  });
  test("rejects a sale larger than the holding", () => {
    expect(() => summarizePortfolio([{ symbol: "BBCA", transactionType: "SELL", quantity: 1, price: 7000, fees: 0 }])).toThrow("SELL exceeds position");
  });
});
