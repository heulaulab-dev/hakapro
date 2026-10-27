import { describe, expect, it } from "vitest";
import response from "./fixtures/idx-stock-summary.2026-08-07.json";
import { fetchIdxStockSummary, idxStockSummaryParams, parseIdxStockSummary } from "./idx-stock-summary";

describe("IDX GetStockSummary contract", () => {
  it("requests the allowlisted stock endpoint with date paging and returns the raw response", async () => {
    let request: { path: string; params: Record<string, string | number | boolean> } | null = null;
    const transport = {
      id: "fixture", async fetchIndexSummary() { return { ok: false as const, reason: "unused" }; },
      async fetchJson(path: string, params: Record<string, string | number | boolean>) {
        request = { path, params };
        return { ok: true as const, body: response };
      },
    };

    await expect(fetchIdxStockSummary(transport, "2026-08-07")).resolves.toEqual({ ok: true, body: response });
    expect(request).toEqual({ path: "/TradingSummary/GetStockSummary", params: { date: "20260807", start: 0, length: 9999 } });
  });

  it("builds the endpoint's compact date and DataTables paging parameters", () => {
    expect(idxStockSummaryParams("2026-08-07")).toEqual({ date: "20260807", start: 0, length: 9999 });
    expect(() => idxStockSummaryParams("2026-02-30")).toThrow(/YYYY-MM-DD/);
  });

  it("normalizes OHLCV, turnover, frequency, and foreign-flow shares from the official response shape", () => {
    const parsed = parseIdxStockSummary(response, "2026-08-07");

    expect(parsed.rejected).toEqual([]);
    expect(parsed.rows).toEqual([{
      symbol: "AADI", date: "2026-08-07", open: 9000, high: 9200, low: 8950, close: 9075,
      previousClose: 8950, volume: 3482700, value: 31599307500, frequency: 2736, foreignBuy: 1240100, foreignSell: 845200,
    }]);
  });

  it("rejects stale dates, empty symbols, non-positive closes, and negative market counts", () => {
    const rows = [
      { ...response.data[0], StockCode: "BBCA", Date: "2026-08-06T00:00:00" },
      { ...response.data[0], StockCode: " ", Date: "2026-08-07T00:00:00" },
      { ...response.data[0], StockCode: "IDX", Date: "2026-08-07T00:00:00", Close: 0 },
      { ...response.data[0], StockCode: "BAD", Date: "2026-08-07T00:00:00", Volume: -1 },
    ];

    const parsed = parseIdxStockSummary({ ...response, recordsTotal: rows.length, recordsFiltered: rows.length, data: rows }, "2026-08-07");

    expect(parsed.rows).toEqual([]);
    expect(parsed.rejected.map(({ reason }) => reason)).toEqual(["date-mismatch", "invalid-symbol", "non-positive-close", "negative-market-value"]);
  });
});
