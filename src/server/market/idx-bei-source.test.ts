import { describe, expect, test, vi } from "vitest";
import { wib } from "../../../tests/support/fixtures";
import { IdxBeiSource } from "./idx-bei-source";

const meta = { source: "idx-bei/stock_summary", fetchedAt: "2026-09-18T10:00:00Z", dataAsOf: "2026-09-17", freshness: "EOD" };

describe("IdxBeiSource", () => {
  test("screen: change1D converts percent ↔ fraction both ways; freshness re-derived from dataAsOf", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.conditions[0]).toMatchObject({ field: "change1D", value: 0.05 });
      return Response.json({ data: { rows: [{ symbol: "BBCA", name: "Bank Central Asia", change1D: 0.0612, price: 6300 }], total: 1, supportedFields: ["change1D", "price"] }, meta });
    });
    const source = new IdxBeiSource("http://market.test", () => wib("2026-09-18T10:30:00"), fetcher as unknown as typeof fetch);
    const result = await source.screen({ conditions: [{ field: "change1D", operator: "GT", value: 5, connective: "AND" }], limit: 50 });
    expect(result.data.rows[0].change1D).toBeCloseTo(6.12, 6);
    expect(result.freshness).toBe("EOD");
    expect(result.source).toBe("idx-bei");
  });

  test("quote change percent is converted to percent units", async () => {
    const fetcher = async () => Response.json({ data: { quote: { symbol: "BBCA", timestamp: "2026-09-17", open: 1, high: 1, low: 1, close: 6300, previousClose: 6350, change: -50, changePercent: -0.0079, volume: 1, value: 1, frequency: 1, foreignBuy: 1, foreignSell: 1 }, candles: [] }, meta });
    const result = await new IdxBeiSource("http://market.test", () => wib("2026-09-18T10:30:00"), fetcher as unknown as typeof fetch).stock("BBCA");
    expect(result.data.quote.changePercent).toBeCloseTo(-0.79, 6);
  });

  test("schema drift is MALFORMED_PROVIDER_RESPONSE", async () => {
    const fetcher = async () => Response.json({ data: { indices: "nope" }, meta });
    await expect(new IdxBeiSource("http://market.test", undefined, fetcher as unknown as typeof fetch).marketOverview()).rejects.toMatchObject({ code: "MALFORMED_PROVIDER_RESPONSE" });
  });
});
