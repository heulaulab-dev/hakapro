import { describe, expect, test, vi } from "vitest";
import { ZodError } from "zod";
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

  test("screen: percentage ratios convert between app percentage points and engine fractions", async () => {
    let sentValues: number[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      sentValues = body.conditions.map((condition: { value: number }) => condition.value);
      return Response.json({ data: {
        rows: [{ symbol: "BBCA", name: "Bank Central Asia", roe: 0.2, roa: 0.03, dividendYield: -0.05 }], total: 1,
        supportedFields: ["roe", "roa", "dividendYield"],
      }, meta });
    });
    const source = new IdxBeiSource("http://market.test", () => wib("2026-09-18T10:30:00"), fetcher as unknown as typeof fetch);
    const result = await source.screen({ conditions: [
      { field: "roe", operator: "GT", value: 20, connective: "AND" },
      { field: "roa", operator: "GTE", value: 3, connective: "AND" },
      { field: "dividendYield", operator: "LT", value: -5, connective: "AND" },
    ], limit: 50 });
    expect(sentValues).toEqual([0.2, 0.03, -0.05]);
    expect(result.data.rows[0]).toMatchObject({ roe: 20, roa: 3, dividendYield: -5 });
  });

  test("quote change percent is converted to percent units", async () => {
    const fetcher = async () => Response.json({ data: { quote: { symbol: "BBCA", timestamp: "2026-09-17", open: 1, high: 1, low: 1, close: 6300, previousClose: 6350, change: -50, changePercent: -0.0079, volume: 1, value: 1, frequency: 1, foreignBuy: 1, foreignSell: 1 }, candles: [] }, meta });
    const result = await new IdxBeiSource("http://market.test", () => wib("2026-09-18T10:30:00"), fetcher as unknown as typeof fetch).stock("BBCA");
    expect(result.data.quote.changePercent).toBeCloseTo(-0.79, 6);
  });

  test("breadth history validates the window and requests the bounded engine route", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("http://market.test/v1/breadth/history?window=6M");
      return Response.json({ data: { window: "6M", snapshotDate: "2026-09-17", source: "daily_prices", freshness: "EOD", series: [] }, meta });
    });
    const source = new IdxBeiSource("http://market.test", () => wib("2026-09-18T10:30:00"), fetcher as unknown as typeof fetch);
    const result = await source.breadthHistory("6M");
    expect(result.data.window).toBe("6M");
    expect(result.freshness).toBe("EOD");
    await expect(source.breadthHistory("bad" as "6M")).rejects.toBeInstanceOf(ZodError);
  });

  test("stock-sector rotation validates options and calls the bounded Engine route", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe("http://market.test/v1/sector-rotation/stocks?sector=Energy&interval=daily");
      return Response.json({ data: {
        sector: "Energy", sectors: [{ name: "Energy", members: 4 }], interval: "daily", from: "2026-07-01", to: "2026-10-01", sessions: 60,
        universe: { activeMembers: 4, eligibleIssuers: 4, returnedIssuers: 4, truncated: false }, minPeerConstituents: 2, requiredObservations: 34,
        stocks: [{ symbol: "BBCA", name: "Bank", peers: 3, basketCoveragePercent: 100, alignedObservations: 60, latest: null, points: [] }],
      }, meta });
    });
    const source = new IdxBeiSource("http://market.test", () => wib("2026-09-18T10:30:00"), fetcher as unknown as typeof fetch);
    const result = await source.stockSectorRotation({ sector: "Energy", interval: "daily" });
    expect(result.data.sector).toBe("Energy");
    expect(result.data.stocks[0]?.alignedObservations).toBe(60);
    await expect(source.stockSectorRotation({ sector: "Energy", interval: "hourly" as "daily" })).rejects.toBeInstanceOf(ZodError);
  });

  test("ownership network defaults to latest and validates selected snapshot month", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      expect(["http://market.test/v1/ownership/network", "http://market.test/v1/ownership/network?month=2026-08"]).toContain(String(url));
      return Response.json({ data: {
        availability: "ENABLED", months: ["2026-08", "2026-07"], month: "2026-08", snapshotDate: "2026-08-31", issuers: 0, holdings: 0,
        issuerRecords: [], rows: [], network: { nodes: [], edges: [], ambiguous: 0 },
        comparison: { status: "COMPARED", fromMonth: "2026-07", comparedIssuers: 0, statusCounts: { COMPARED: 0, NO_PREVIOUS: 0, NOT_ADJACENT: 0, REFUSED: 0 }, counts: { NEW: 0, INCREASE: 0, DECREASE: 0, EXIT: 0, UNCHANGED: 0, BELOW_THRESHOLD: 0, AMBIGUOUS: 0 } },
      }, meta });
    });
    const source = new IdxBeiSource("http://market.test", () => wib("2026-09-18T10:30:00"), fetcher as unknown as typeof fetch);
    expect((await source.ownershipNetwork({})).data.month).toBe("2026-08");
    const result = await source.ownershipNetwork({ month: "2026-08" });
    expect(result.data.month).toBe("2026-08");
    expect(result.freshness).toBe("HISTORICAL");
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(["http://market.test/v1/ownership/network", "http://market.test/v1/ownership/network?month=2026-08"]);
    await expect(source.ownershipNetwork({ month: "2026-8" })).rejects.toBeInstanceOf(ZodError);
  });

  test("schema drift is MALFORMED_PROVIDER_RESPONSE", async () => {
    const fetcher = async () => Response.json({ data: { indices: "nope" }, meta });
    await expect(new IdxBeiSource("http://market.test", undefined, fetcher as unknown as typeof fetch).marketOverview()).rejects.toMatchObject({ code: "MALFORMED_PROVIDER_RESPONSE" });
  });
});
