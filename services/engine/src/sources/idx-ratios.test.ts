import { describe, expect, it } from "vitest";
import fixture from "./fixtures/idx-financial-ratios.2024-Q2.json";
import { idxRatioParams, parseIdxRatioPage, toIdxStockRatios } from "./idx-ratios";

describe("IDX financial ratios", () => {
  it("builds period/page params and preserves source metrics with percent units", () => {
    expect(idxRatioParams({ year: 2024, quarter: 2, periodType: "quarterly", page: 1 })).toMatchObject({ urlName: "LINK_FINANCIAL_DATA_RATIO", periodYear: 2024, periodQuarter: 2, pageNumber: 1 });
    const page = parseIdxRatioPage(fixture, { year: 2024, quarter: 2, periodType: "quarterly" });
    expect(page.rows[0]).toMatchObject({ symbol: "AADI", fsDate: "2024-06-30", periodType: "quarterly", audit: "A", opinion: "WTM", sharia: "S", metrics: { roe: 47.318, roa: 23.6977, npm: 48.4661, per: 3.13 } });
    expect(toIdxStockRatios(page.rows[0]).map(({ ratio, value }) => ({ ratio, value: Math.round((value ?? 0) * 1e6) / 1e6 }))).toEqual([
      { ratio: "per", value: 3.13 }, { ratio: "pbv", value: 1.48 }, { ratio: "roe", value: 0.47318 }, { ratio: "roa", value: 0.236977 }, { ratio: "eps", value: 2710.63 }, { ratio: "der", value: 1 },
    ]);
  });
  it("keeps null metrics and rejects bad dates, symbols, and nonnumeric metrics", () => {
    const page = parseIdxRatioPage({ data: [{ code: "BBCA", fsDate: "2024-06-30", per: null, roe: null }, { code: "???", fsDate: "2024-06-30" }, { code: "BBRI", fsDate: "bad" }, { code: "BBNI", fsDate: "2024-06-30", per: "unknown" }] }, { year: 2024, quarter: 2, periodType: "quarterly" });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].metrics.per).toBeNull();
    expect(page.rejected).toHaveLength(3);
  });
});
