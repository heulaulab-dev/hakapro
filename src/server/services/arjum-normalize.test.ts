import { describe, expect, test } from "vitest";
import { fixture } from "../../../tests/support/fixtures";
import {
  brokerSummaryResponseSchema, doneDetailsResponseSchema, financialStatementsResponseSchema, historyResponseSchema,
  insidersResponseSchema, marketCapResponseSchema, seasonalityResponseSchema,
} from "@/server/schemas/arjum";
import {
  buildFinancialRows, normalizeBrokerSummary, normalizeDoneDetails, normalizeHistory, normalizeInsiders,
  normalizeMarketCap, normalizeSeasonality, rankBrokers,
} from "./arjum-normalize";

describe("units verified against recorded data", () => {
  test("history volume is in shares (value / volume equals the average price)", () => {
    const rows = normalizeHistory(historyResponseSchema.parse(fixture("history"))).rows;
    for (const row of rows.slice(-5)) expect(row.valueIdr / row.volumeShares).toBeCloseTo(row.averageIdr, 3);
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
