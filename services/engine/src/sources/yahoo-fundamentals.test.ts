// Yahoo fundamentals timeseries parser against trimmed real responses recorded on 2026-10-16 (test/fixtures/, see
// README "Fixtures"): BBCA (bank: no gross profit, Yahoo skips Q3-2025), TLKM (four consecutive quarters) and
// GOTO (losses).
import { describe, expect, it } from "vitest";
import { fixture } from "../../test/support";
import { FUNDAMENTAL_METRICS, FUNDAMENTAL_TYPES, FundamentalsMismatchError, fundamentalsUrl, METRIC_UNITS, parseFundamentals } from "./yahoo-fundamentals";

const point = (parsed: ReturnType<typeof parseFundamentals>, metric: string, periodType: string, periodEnd: string) =>
  parsed.points.find((row) => row.metric === metric && row.periodType === periodType && row.periodEnd === periodEnd);

describe("Yahoo fundamentals timeseries", () => {
  it("builds one stable URL per symbol and day with every annual and quarterly line", () => {
    const url = new URL(fundamentalsUrl("BBCA.JK", "2026-10-17"));
    expect(`${url.origin}${url.pathname}`).toBe("https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/BBCA.JK");
    expect([...url.searchParams.keys()]).toEqual(["type", "period1", "period2"]);
    expect(url.searchParams.get("period1")).toBe(String(Date.parse("2020-01-01T00:00:00+07:00") / 1000));
    expect(url.searchParams.get("period2")).toBe(String(Date.parse("2026-10-17T00:00:00+07:00") / 1000));
    const types = url.searchParams.get("type")!.split(",");
    expect(types).toEqual(FUNDAMENTAL_TYPES);
    expect(types).toHaveLength(Object.keys(FUNDAMENTAL_METRICS).length * 2);
    expect(types.slice(0, 2)).toEqual(["annualTotalRevenue", "annualGrossProfit"]);
    expect(types).toContain("quarterlyStockholdersEquity");
    expect(fundamentalsUrl("BBCA.JK", "2026-10-17")).toBe(fundamentalsUrl("BBCA.JK", "2026-10-17"));
  });

  it("maps a bank's statement lines to metric keys with units and the filing currency", () => {
    const parsed = parseFundamentals(fixture("yahoo-fundamentals-BBCA.json"), "BBCA.JK");
    expect(parsed).toMatchObject({ ticker: "BBCA.JK", currencies: ["IDR"], skipped: 0 });
    expect(parsed.points).toHaveLength(101);
    expect(point(parsed, "netIncome", "quarterly", "2026-06-30")).toEqual({ periodEnd: "2026-06-30", periodType: "quarterly", metric: "netIncome", value: 14850323000000, unit: "amount", currency: "IDR" });
    expect(point(parsed, "netIncome", "annual", "2025-12-31")?.value).toBe(57537287000000);
    expect(point(parsed, "epsDiluted", "annual", "2025-12-31")).toMatchObject({ value: 467, unit: "per_share", currency: "IDR" });
    // Share counts carry no currency, whatever Yahoo's currencyCode says.
    expect(point(parsed, "sharesOutstanding", "quarterly", "2026-06-30")).toMatchObject({ value: 122841751300, unit: "shares", currency: null });
    expect(point(parsed, "commonDividendsPaid", "annual", "2025-12-31")?.value).toBe(-37595047000000);
    // A bank has no gross profit: Yahoo answers that type with `meta` only, and nothing is stored (never a 0).
    expect(parsed.points.some((row) => row.metric === "grossProfit")).toBe(false);
    // Yahoo skips Q3-2025 for BBCA: five quarters, not consecutive.
    expect([...new Set(parsed.points.filter((row) => row.periodType === "quarterly" && row.metric === "netIncome").map((row) => row.periodEnd))].sort())
      .toEqual(["2025-03-31", "2025-06-30", "2025-12-31", "2026-03-31", "2026-06-30"]);
    expect([...new Set(parsed.points.filter((row) => row.periodType === "annual").map((row) => row.periodEnd))].sort()).toEqual(["2022-12-31", "2023-12-31", "2024-12-31", "2025-12-31"]);
    // Newest period first.
    expect(parsed.points[0].periodEnd).toBe("2026-06-30");
  });

  it("parses a non-bank (gross profit, capex) and a loss-maker (negative values)", () => {
    const tlkm = parseFundamentals(fixture("yahoo-fundamentals-TLKM.json"), "TLKM.JK");
    expect(tlkm.points).toHaveLength(120);
    expect(point(tlkm, "grossProfit", "annual", "2025-12-31")?.value).toBe(98490000000000);
    expect(point(tlkm, "capitalExpenditure", "quarterly", "2026-06-30")?.value).toBe(-6366000000000);
    // Reported zeros are kept as zeros (they are values, not gaps).
    expect(point(tlkm, "dividendsPaid", "quarterly", "2025-09-30")?.value).toBe(0);
    expect([...new Set(tlkm.points.filter((row) => row.periodType === "quarterly" && row.metric === "netIncome").map((row) => row.periodEnd))].sort())
      .toEqual(["2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"]);

    const goto = parseFundamentals(fixture("yahoo-fundamentals-GOTO.json"), "GOTO.JK");
    expect(goto.points).toHaveLength(69);
    expect(point(goto, "netIncome", "annual", "2025-12-31")?.value).toBe(-1185654000000);
    expect(point(goto, "epsDiluted", "annual", "2023-12-31")?.value).toBe(-85);
  });

  it("skips null slots, null values, contradicting period tags and unknown types; refuses another ticker", () => {
    const slot = (asOfDate: string, raw: number | null, periodType = "12M") => ({ asOfDate, periodType, currencyCode: "USD", reportedValue: raw === null ? null : { raw } });
    const body = JSON.stringify({ timeseries: { error: null, result: [
      { meta: { symbol: ["ADRO.JK"], type: ["annualNetIncome"] }, annualNetIncome: [null, slot("2024-12-31", null), slot("2025-12-31", 1.5e9), slot("2023-12-31", 9, "3M")] },
      { meta: { symbol: ["ADRO.JK"], type: ["annualSomethingNew"] }, annualSomethingNew: [slot("2025-12-31", 1)] },
      { meta: { symbol: ["ADRO.JK"], type: ["trailingNetIncome"] }, trailingNetIncome: [slot("2025-12-31", 1)] },
      { meta: { symbol: ["ADRO.JK"], type: ["quarterlyTotalAssets"] } },
    ] } });
    const parsed = parseFundamentals(body, "ADRO.JK");
    expect(parsed.points).toEqual([{ periodEnd: "2025-12-31", periodType: "annual", metric: "netIncome", value: 1.5e9, unit: "amount", currency: "USD" }]);
    expect(parsed).toMatchObject({ skipped: 2, currencies: ["USD"] });
    expect(() => parseFundamentals(body, "BBCA.JK")).toThrow(FundamentalsMismatchError);
    expect(() => parseFundamentals('{"timeseries":"nope"}', "BBCA.JK")).toThrow();
    expect(() => parseFundamentals("<html>", "BBCA.JK")).toThrow(SyntaxError);
    expect(parseFundamentals('{"timeseries":{"result":null,"error":null}}', "BBCA.JK").points).toEqual([]);
  });

  it("gives every metric one unit", () => {
    expect(METRIC_UNITS).toMatchObject({ revenue: "amount", epsDiluted: "per_share", sharesOutstanding: "shares", equity: "amount" });
    expect(new Set(Object.values(FUNDAMENTAL_METRICS).map((metric) => metric.key)).size).toBe(Object.keys(FUNDAMENTAL_METRICS).length);
  });
});
