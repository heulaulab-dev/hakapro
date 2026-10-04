import { describe, expect, test } from "vitest";
import { fixture } from "../../../tests/support/fixtures";
import { brokerSummaryResponseSchema, financialStatementsResponseSchema, historyResponseSchema, insidersResponseSchema } from "@/server/schemas/arjum";
import { normalizeBrokerSummary, normalizeFinancialStatements, normalizeHistory, normalizeInsiders } from "./arjum-normalize";
import { summarizeBrokers, summarizeFinancials, summarizeForeignFlow, summarizeInsiders, summarizePrice } from "./stock-summary";

const history = () => normalizeHistory(historyResponseSchema.parse(fixture("history")));

describe("summaries from recorded BBCA data", () => {
  test("price facts", () => {
    const facts = summarizePrice(history(), 63)!;
    expect(facts).toMatchObject({ date: "2026-09-18", close: 6300, change: -50, changePercent: -0.79, rangeSessions: 63 });
    expect(facts.rangeHigh).toBeGreaterThanOrEqual(facts.rangeLow);
    expect(facts.sma20).not.toBeNull();
    expect(facts.closeVsSma20).toBe(facts.close > facts.sma20! ? "above" : "below");
  });

  test("foreign flow over the last 5 sessions", () => {
    const rows = history().rows.slice(-5);
    const facts = summarizeForeignFlow(history())!;
    expect(facts.sessions).toBe(5);
    expect(facts.netSellSessions).toBe(rows.filter((row) => row.foreignNetShares < 0).length);
    expect(facts.netShares).toBe(rows.reduce((sum, row) => sum + row.foreignNetShares, 0));
    expect(facts.netShares20).not.toBeNull();
  });

  test("brokers: top net buyers; no invented sellers when all are net buyers", () => {
    const facts = summarizeBrokers(normalizeBrokerSummary(brokerSummaryResponseSchema.parse(fixture("broker-summary"))))!;
    expect(facts.topBuyers.map((row) => row.code)).toEqual(["YU", "CC", "SQ"]);
    expect(facts.topSellers).toEqual([]);
  });

  test("insiders", () => {
    const { data } = normalizeInsiders(insidersResponseSchema.parse(fixture("insiders")));
    const facts = summarizeInsiders(data);
    expect(facts).toMatchObject({ transactions: 10, buys: 10, sells: 0, latestDate: "2026-03-25", totalReported: 85 });
    expect(facts.netChangeShares).toBe(data.rows.reduce((sum, row) => sum + row.changeShares!, 0));
  });

  test("financials surface reporting lag", () => {
    const statements = normalizeFinancialStatements(financialStatementsResponseSchema.parse(fixture("financial-statements")), "2026-10-03");
    expect(summarizeFinancials(statements)).toEqual({ reportType: "INCOME_STATEMENT", latestPeriod: "Q1 2026", latestPeriodEnd: "2026-03-31", expectedPeriodEnd: "2026-06-30", behind: true, periods: 12 });
  });
});

describe("edge cases", () => {
  test("empty inputs never produce zeros", () => {
    expect(summarizePrice({ symbol: "X", frame: "daily", rows: [], available: null })).toBeNull();
    expect(summarizeForeignFlow({ symbol: "X", frame: "daily", rows: [], available: null })).toBeNull();
    expect(summarizeBrokers({ symbol: "X", startDate: "", endDate: "", availableFrom: "", availableTo: "", flow: "all", net: false, brokers: [], levels: [] })).toBeNull();
  });

  test("sells count negative; an unparseable change makes the net unknown", () => {
    const base = { person: "A", date: "2026-01-01", nationality: "local", roles: [], broker: null, previousShares: null, currentShares: null, previousPercent: null, currentPercent: null, changePercent: null, priceIdr: null };
    const insiders = { symbol: "X", total: 2, page: 1, pageSize: 10, totalPages: 1, rows: [{ ...base, action: "BUY" as const, changeShares: 100 }, { ...base, action: "SELL" as const, changeShares: 40 }] };
    expect(summarizeInsiders(insiders).netChangeShares).toBe(60);
    expect(summarizeInsiders({ ...insiders, rows: [...insiders.rows, { ...base, action: "BUY" as const, changeShares: null }] }).netChangeShares).toBeNull();
  });

  test("SMA is withheld when fewer than 20 sessions exist", () => {
    const short = { ...history(), rows: history().rows.slice(-10) };
    expect(summarizePrice(short)!.sma20).toBeNull();
  });
});
