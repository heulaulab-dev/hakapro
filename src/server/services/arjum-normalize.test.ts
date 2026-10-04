import { describe, expect, test } from "vitest";
import { fixture, sample } from "../../../tests/support/fixtures";
import {
  brokerSummaryResponseSchema, doneDetailsResponseSchema, financialStatementsResponseSchema, historyResponseSchema,
  insidersResponseSchema, marketCapResponseSchema, priceResponseSchema, seasonalityResponseSchema,
} from "@/server/schemas/arjum";
import {
  buildFinancialRows, normalizeBrokerSummary, normalizeDoneDetails, normalizeFinancialStatements, normalizeHistory, normalizeInsiders,
  normalizeMarketCap, normalizePrice, normalizeSeasonality, rankBrokers,
} from "./arjum-normalize";

describe("units verified against recorded data", () => {
  test("history volume is in shares (value / volume equals the average price)", () => {
    const rows = normalizeHistory(historyResponseSchema.parse(fixture("history"))).rows;
    for (const row of rows.slice(-5)) if (row.averageIdr !== null) expect(row.valueIdr / row.volumeShares).toBeCloseTo(row.averageIdr, 3);
  });

  test("history change is in percent units and rows are sorted ascending", () => {
    const rows = normalizeHistory(historyResponseSchema.parse(fixture("history"))).rows;
    const latest = rows.at(-1)!;
    expect(latest.date).toBe("2026-09-18");
    expect(latest.changePercent).toBe(-0.79);
    expect(rows[0].date < latest.date).toBe(true);
  });

  test("done-details quantity is in lots of 100 shares", () => {
    const rows = normalizeDoneDetails(doneDetailsResponseSchema.parse(fixture("done-details"))).rows.filter((row) => row.lots > 0);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.valueIdr).toBe(row.lots * 100 * row.priceIdr);
  });
});

test("broker summary: nets computed, sorted by net value, rankable by other measures", () => {
  const rows = normalizeBrokerSummary(brokerSummaryResponseSchema.parse(fixture("broker-summary"))).brokers;
  expect(rows[0].netValueIdr).toBeGreaterThanOrEqual(rows[1].netValueIdr);
  expect(rows[0].netFrequency).toBe(rows[0].buyFrequency - rows[0].sellFrequency);
  const byVolume = rankBrokers(rows, "VOLUME");
  expect(byVolume[0].netVolumeShares).toBe(Math.max(...rows.map((row) => row.netVolumeShares)));
});

test("financial rows keep hierarchy and align with periods", () => {
  const parsed = financialStatementsResponseSchema.parse(fixture("financial-statements"));
  const rows = buildFinancialRows(parsed.items);
  expect(rows.some((row) => row.depth > 0)).toBe(true);
  expect(rows.every((row) => row.values.length === parsed.items.length)).toBe(true);
});

test("seasonality has 12 months per year row", () => {
  const matrix = normalizeSeasonality(seasonalityResponseSchema.parse(fixture("seasonal")));
  expect(matrix.rows[0].valuesPercent).toHaveLength(12);
  expect(matrix.summary[0]).toMatchObject({ month: "Jan" });
});

test("market cap uses numeric fields, not labels", () => {
  const row = normalizeMarketCap(marketCapResponseSchema.parse(fixture("market-cap"))).rows[0];
  expect(row).toEqual({ symbol: "BBCA", name: "Bank Central Asia Tbk.", closeIdr: 6300, marketCapIdr: 768866486850000, listedShares: 122042299500, turnoverRatio: 0.001448 });
});

describe("insiders: provider strings parsed into numbers", () => {
  test("recorded sample parses fully with no issues", () => {
    const { data, issues } = normalizeInsiders(insidersResponseSchema.parse(fixture("insiders")));
    expect(issues).toEqual([]);
    expect(data.rows[0]).toMatchObject({ action: "BUY", previousShares: 7_502_058, currentShares: 7_819_950, changeShares: 317_892, previousPercent: 0.0061, priceIdr: 6_982, broker: null, roles: ["KOMISARIS"] });
    for (const row of data.rows) expect(row.currentShares! - row.previousShares!).toBe(row.changeShares);
  });

  test("an unparseable string becomes null plus an issue", () => {
    const value = insidersResponseSchema.parse(fixture("insiders"));
    value.items[0].price_formatted = "n/a";
    const { data, issues } = normalizeInsiders(value);
    expect(data.rows[0].priceIdr).toBeNull();
    expect(issues).toEqual([expect.objectContaining({ field: "insiders.price_formatted", input: "n/a" })]);
  });
});

describe("Checkpoint 3 freshness corrections", () => {
  test("financial statements: period end per period, fetch time kept separately, lag surfaced", async () => {
    const { normalizeFinancialStatements } = await import("./arjum-normalize");
    const data = normalizeFinancialStatements(financialStatementsResponseSchema.parse(fixture("financial-statements")), "2026-10-03");
    expect(data.periods[0]).toEqual({ year: "2026", quarter: "1", label: "Q1 2026", periodEnd: "2026-03-31", filingDate: null, fetchedAt: "2026-09-13 18:06:34" });
    expect(data.reportingLag).toEqual({ latestPeriodEnd: "2026-03-31", expectedPeriodEnd: "2026-06-30", behind: true });
    const onTime = normalizeFinancialStatements(financialStatementsResponseSchema.parse(fixture("financial-statements")), "2026-05-15");
    expect(onTime.reportingLag.behind).toBe(false);
  });

  test("seasonality coverage is derived from the data", () => {
    const matrix = normalizeSeasonality(seasonalityResponseSchema.parse(fixture("seasonal")));
    expect(matrix.coverage).toEqual({ from: "2020-01", to: "2026-09" });
  });
});

describe("2026-10-04 additions (live samples)", () => {
  test("broker summary: range, available span and rank-paired levels", () => {
    const data = normalizeBrokerSummary(brokerSummaryResponseSchema.parse(sample("broker-summary-BBCA-range.json")));
    expect(data).toMatchObject({ startDate: "2026-09-01", endDate: "2026-10-02", availableFrom: "2020-01-02", availableTo: "2026-10-02", flow: "all", net: false });
    expect(data.levels).toHaveLength(25);
    expect(data.levels[0]).toMatchObject({ rank: 1, buy: { code: "YU", frequency: 61014 }, sell: { code: "ZP" } });
  });

  test("broker summary with net=true: level sides have no frequency", () => {
    const data = normalizeBrokerSummary(brokerSummaryResponseSchema.parse(sample("broker-summary-BBCA-net.json")));
    expect(data.net).toBe(true);
    expect(data.levels[0].buy?.frequency).toBeNull();
    expect(data.levels[0].buy?.averagePriceIdr).toBeGreaterThan(0);
  });

  test("history keeps the provider's available range; older recordings have none", () => {
    expect(normalizeHistory(historyResponseSchema.parse(sample("history-BBCA-range.json"))).available).toEqual({ from: "2020-01-02", to: "2026-10-02" });
    expect(normalizeHistory(historyResponseSchema.parse(fixture("history"))).available).toBeNull();
  });

  test("market cap by symbols reports symbols without data", () => {
    const data = normalizeMarketCap(marketCapResponseSchema.parse(sample("market-cap-codes.json")));
    expect(data.rows.map((row) => row.symbol)).toEqual(["BBCA", "TLKM"]);
    expect(data.notFound).toEqual(["ZZZZ"]);
  });

  test("annual statements: provider 'annually' becomes 'annual' with year-end period ends", () => {
    const data = normalizeFinancialStatements(financialStatementsResponseSchema.parse(sample("financial-statements-BBCA-annually.json")), "2026-10-04");
    expect(data.period).toBe("annual");
    expect(data.periods[0]).toMatchObject({ label: "FY 2025", periodEnd: "2025-12-31" });
    expect(data.reportingLag).toEqual({ latestPeriodEnd: "2025-12-31", expectedPeriodEnd: "2025-12-31", behind: false });
  });

  test("price on a weekend: last close carried over, session from source_date", () => {
    expect(normalizePrice(priceResponseSchema.parse(sample("price-BBCA-weekend.json")), "2026-10-04")).toEqual({
      symbol: "BBCA", lastPriceIdr: 6100, frequency: 0, lots: 0, valueIdr: 0, sessionDate: "2026-10-02", tradedToday: false,
      lastTradeTime: null, servedTime: "07:54:48", marketState: "weekend", quoteAgeMs: null,
    });
  });

  test("price traded today belongs to today; a closed market labelled libur is a holiday", () => {
    const traded = { code: "BBCA", last_price: 6225, freq: 14203, lot: 275e3, value: 226875e6, data_ts: "14:32:07", served_ts: "15:50:13", market_state: "open", market_label: "Sesi 2", no_trade_today: false, quote_age_ms: 4686e3 };
    expect(normalizePrice(traded, "2026-10-05")).toMatchObject({ sessionDate: "2026-10-05", tradedToday: true, lastTradeTime: "14:32:07", marketState: "open" });
    expect(normalizePrice({ ...traded, data_ts: null, no_trade_today: true, source_date: "2026-12-24", market_state: "closed", market_label: "Bursa libur" }, "2026-12-25").marketState).toBe("holiday");
  });
});
