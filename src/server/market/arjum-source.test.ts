import { describe, expect, test } from "vitest";
import type { z } from "zod";
import { fixture, sample, wib } from "../../../tests/support/fixtures";
import type { RawFetcher } from "@/server/providers/arjum/client";
import { compareAnalyses } from "@/server/services/analysis-compare";
import { getQuotes } from "@/server/services/quotes";
import { ArjumSource } from "./arjum-source";
import { MarketDataError } from "./errors";

type Call = { path: string; query: Record<string, unknown> };

/** Records every provider request and answers from the given bodies (by path prefix). */
function fakeFetcher(bodies: Record<string, unknown | (() => unknown)>) {
  const calls: Call[] = [];
  const fetchRaw = (async <T extends z.ZodType>(path: string, schema: T, query: Record<string, unknown> = {}) => {
    calls.push({ path, query: Object.fromEntries(Object.entries(query).filter(([, value]) => value !== undefined)) });
    const key = Object.keys(bodies).find((prefix) => path.startsWith(prefix));
    if (!key) throw new MarketDataError("NOT_FOUND", path, 404);
    const body = bodies[key];
    return schema.parse(typeof body === "function" ? body() : body);
  }) as RawFetcher;
  return { fetchRaw, calls };
}

describe("documented parameters reach the provider in its own vocabulary", () => {
  test("financial period annual → annually, cash flow → CASH_FLOW_REPORT", async () => {
    const { fetchRaw, calls } = fakeFetcher({ "/api/financial-statements/": sample("financial-statements-BBCA-annually.json") });
    const envelope = await new ArjumSource(fetchRaw, "arjum", () => wib("2026-10-04T10:00:00")).financialStatements("BBCA", { reportType: "CASH_FLOW", period: "annual", limit: 5, year: "2025" });
    expect(calls[0]).toEqual({ path: "/api/financial-statements/BBCA", query: { report_type: "CASH_FLOW_REPORT", period: "annually", limit: 5, year: "2025" } });
    expect(envelope).toMatchObject({ freshness: "HISTORICAL", asOf: "2025-12-31", period: "FY 2025" });
  });

  test("broker summary: dates, flow, net and limits; a multi-session range is HISTORICAL", async () => {
    const { fetchRaw, calls } = fakeFetcher({ "/api/broker-summary/": sample("broker-summary-BBCA-range.json") });
    const source = new ArjumSource(fetchRaw, "arjum", () => wib("2026-10-04T10:00:00"));
    const envelope = await source.brokerSummary("BBCA", { startDate: "2026-09-01", endDate: "2026-10-02", flow: "foreign", net: true, brokerLimit: 200, levelLimit: 50 });
    expect(calls[0].query).toEqual({ start_date: "2026-09-01", end_date: "2026-10-02", flow: "F", net: "true", broker_limit: 200, level_limit: 50 });
    expect(envelope).toMatchObject({ freshness: "HISTORICAL", asOf: "2026-10-02", period: "2026-09-01/2026-10-02" });
    await source.brokerSummary("BBCA", { flow: "all", net: false });
    expect(calls[1].query).toEqual({});
  });

  test("market cap by symbols sends codes and no paging", async () => {
    const { fetchRaw, calls } = fakeFetcher({ "/api/market-cap": sample("market-cap-codes.json") });
    await new ArjumSource(fetchRaw).marketCap({ symbols: ["BBCA", "TLKM", "ZZZZ"], page: 3, perPage: 10 });
    expect(calls[0]).toEqual({ path: "/api/market-cap", query: { codes: "BBCA,TLKM,ZZZZ" } });
  });

  test("history date range", async () => {
    const { fetchRaw, calls } = fakeFetcher({ "/api/history/": sample("history-BBCA-range.json") });
    const envelope = await new ArjumSource(fetchRaw).history("BBCA", { startDate: "2026-09-01", endDate: "2026-10-02", limit: 20 });
    expect(calls[0].query).toEqual({ start_date: "2026-09-01", end_date: "2026-10-02", limit: 20 });
    expect(envelope.data.available).toEqual({ from: "2020-01-02", to: "2026-10-02" });
  });
});

describe("price freshness", () => {
  const traded = { code: "BBCA", last_price: 6225, freq: 14203, lot: 275e3, value: 226875e6, data_ts: "14:32:07", served_ts: "14:32:09", market_state: "open", market_label: "Sesi 2", no_trade_today: false, quote_age_ms: 2000 };

  test("a trade during today's session is DELAYED (never LIVE) and stamped with its time", async () => {
    const { fetchRaw } = fakeFetcher({ "/api/price/": traded });
    const envelope = await new ArjumSource(fetchRaw, "arjum", () => wib("2026-10-05T14:32:09")).price("BBCA");
    expect(envelope).toMatchObject({ freshness: "DELAYED", asOf: "2026-10-05T14:32:07+07:00" });
  });

  test("a carried-over close on a weekend is the last completed session (EOD)", async () => {
    const { fetchRaw } = fakeFetcher({ "/api/price/": sample("price-BBCA-weekend.json") });
    const envelope = await new ArjumSource(fetchRaw, "arjum", () => wib("2026-10-04T07:54:48")).price("BBCA");
    expect(envelope).toMatchObject({ freshness: "EOD", asOf: "2026-10-02" });
  });

  test("quotes add today's price only once a trading session has opened", async () => {
    const bodies = { "/api/history/": fixture("history"), "/api/price/": { ...traded, data_ts: "10:00:00" } };
    const weekend = fakeFetcher(bodies);
    await getQuotes(new ArjumSource(weekend.fetchRaw, "arjum", () => wib("2026-10-04T10:00:00")), ["BBCA"], undefined, wib("2026-10-04T10:00:00"));
    expect(weekend.calls.map((call) => call.path)).toEqual(["/api/history/BBCA"]);

    const session = fakeFetcher(bodies);
    const now = () => wib("2026-09-21T10:00:01");
    const quotes = await getQuotes(new ArjumSource(session.fetchRaw, "arjum", now), ["BBCA"], undefined, now());
    expect(session.calls.map((call) => call.path).sort()).toEqual(["/api/history/BBCA", "/api/price/BBCA"]);
    // History ends Friday 2026-09-18; Monday's price is measured against that close.
    expect(quotes.data[0]).toMatchObject({ status: "ok", date: "2026-09-21", close: 6225, change: -75, changePercent: -1.19, lastTradeTime: "10:00:00", marketState: "open", freshness: "DELAYED" });
  });
});

describe("analysis", () => {
  test("is classified by its session date and has no provider wording", async () => {
    const { fetchRaw } = fakeFetcher({ "/api/analysis/": fixture("analysis") });
    const envelope = await new ArjumSource(fetchRaw, "arjum", () => wib("2026-09-19T10:00:00")).analysis("BBCA");
    expect(envelope).toMatchObject({ freshness: "EOD", asOf: "2026-09-18" });
    expect(JSON.stringify(envelope.data)).not.toMatch(/NETRAL|AVOID|Cut loss/);
  });

  test("text without known sections is a malformed response", async () => {
    const { fetchRaw } = fakeFetcher({ "/api/analysis/": { stock_code: "BBCA", output: "Maintenance" } });
    await expect(new ArjumSource(fetchRaw).analysis("BBCA")).rejects.toMatchObject({ code: "MALFORMED_PROVIDER_RESPONSE" });
  });

  test("comparison stops requesting after a rate limit", async () => {
    let served = 0;
    const { fetchRaw, calls } = fakeFetcher({
      "/api/analysis/": () => {
        served += 1;
        if (served === 2) throw new MarketDataError("RATE_LIMITED", "429", 429, 60);
        return fixture("analysis");
      },
    });
    const result = await compareAnalyses(new ArjumSource(fetchRaw), ["BBCA", "BBRI", "TLKM"]);
    expect(calls).toHaveLength(2);
    expect(result.data.map((item) => [item.symbol, item.status === "ok" ? "ok" : item.error])).toEqual([["BBCA", "ok"], ["BBRI", "RATE_LIMITED"], ["TLKM", "RATE_LIMITED"]]);
  });
});
