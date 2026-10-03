import { afterEach, describe, expect, test, vi } from "vitest";
import { wib } from "../../../tests/support/fixtures";
import type { WithFreshness } from "@/lib/freshness";
import { ArjumSource } from "./arjum-source";
import { MarketDataError } from "./errors";
import { clampFixtureFreshness, FIXTURE_SYMBOL, FixtureSource, fixtureFetcher } from "./fixture-source";
import type { MarketDataSource } from "./source";

// Mid-session on the recorded trading day: live rules would call this data DELAYED.
const duringRecordedSession = () => wib("2026-09-18T10:30:00");

const arjumCalls = (source: MarketDataSource): Array<[string, () => Promise<WithFreshness<unknown>>]> => [
  ["search", () => source.search("bank")],
  ["strategies", () => source.strategies()],
  ["brokerSummary", () => source.brokerSummary(FIXTURE_SYMBOL)],
  ["brokerAccumulation", () => source.brokerAccumulation(FIXTURE_SYMBOL, {})],
  ["history", () => source.history(FIXTURE_SYMBOL, {})],
  ["seasonality", () => source.seasonality(FIXTURE_SYMBOL)],
  ["marketCap", () => source.marketCap({})],
  ["financialStatements", () => source.financialStatements(FIXTURE_SYMBOL, {})],
  ["insiders", () => source.insiders(FIXTURE_SYMBOL, {})],
  ["doneDetails", () => source.doneDetails(FIXTURE_SYMBOL, {})],
  ["providerHealth", () => source.providerHealth()],
];

afterEach(() => vi.restoreAllMocks());

describe("fixture mode freshness (Checkpoint 2 rule)", () => {
  test.each(arjumCalls(new FixtureSource(duringRecordedSession)))("%s is HISTORICAL or UNAVAILABLE, never LIVE/DELAYED", async (_name, call) => {
    const result = await call();
    expect(["HISTORICAL", "UNAVAILABLE"]).toContain(result.freshness);
    expect(result.source).toBe("fixture:arjum");
  });

  test("the clamp matters: the same recorded data through live rules would be DELAYED", async () => {
    const live = new ArjumSource(fixtureFetcher, "arjum", duringRecordedSession);
    expect((await live.strategies()).freshness).toBe("DELAYED");
    expect((await new FixtureSource(duringRecordedSession).strategies()).freshness).toBe("HISTORICAL");
  });

  test("clampFixtureFreshness maps every state to HISTORICAL or UNAVAILABLE", () => {
    for (const state of ["LIVE", "DELAYED", "EOD", "HISTORICAL", "STALE"] as const) {
      expect(clampFixtureFreshness(state, "2026-09-18")).toBe("HISTORICAL");
      expect(clampFixtureFreshness(state, null)).toBe("UNAVAILABLE");
    }
    expect(clampFixtureFreshness("UNAVAILABLE", "2026-09-18")).toBe("UNAVAILABLE");
  });

  test("asOf is the data date, not the request time", async () => {
    const result = await new FixtureSource(duringRecordedSession).history(FIXTURE_SYMBOL, {});
    expect(result.asOf).toBe("2026-09-18");
    const financials = await new FixtureSource(duringRecordedSession).financialStatements(FIXTURE_SYMBOL, {});
    expect(financials).toMatchObject({ asOf: "2026-03-31", period: "Q1 2026", freshness: "HISTORICAL" });
    const seasonality = await new FixtureSource(duringRecordedSession).seasonality(FIXTURE_SYMBOL);
    expect(seasonality).toMatchObject({ freshness: "HISTORICAL", asOf: "2026-09", period: "2020-01/2026-09" });
  });

  test("live rules mark financials STALE when the newest period is behind the reporting calendar", async () => {
    const live = new ArjumSource(fixtureFetcher, "arjum", () => wib("2026-10-03T10:00:00"));
    const result = await live.financialStatements(FIXTURE_SYMBOL, {});
    expect(result.freshness).toBe("STALE");
    expect(result.data.reportingLag.behind).toBe(true);
    // Fixture mode caps the label, but the lag itself stays visible in the data.
    const fixtureResult = await new FixtureSource(() => wib("2026-10-03T10:00:00")).financialStatements(FIXTURE_SYMBOL, {});
    expect(fixtureResult.freshness).toBe("HISTORICAL");
    expect(fixtureResult.data.reportingLag.behind).toBe(true);
  });
});

describe("fixture coverage is honest", () => {
  test("another symbol is NOT_RECORDED instead of relabelled BBCA data", async () => {
    await expect(new FixtureSource().history("BBRI", {})).rejects.toMatchObject({ code: "NOT_RECORDED", status: 404 });
    await expect(new FixtureSource().doneDetails("BBRI", {})).rejects.toBeInstanceOf(MarketDataError);
  });

  test("idx-bei capabilities have no recordings and report UNSUPPORTED", async () => {
    await expect(new FixtureSource().marketOverview()).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  test("search filters the recorded rows", async () => {
    const result = await new FixtureSource().search("bbc");
    expect(result.data.map((row) => row.symbol)).toEqual(["BBCA"]);
  });
});

test("why-matched issues are logged, not swallowed", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetcher: typeof fixtureFetcher = async (path, schema, query) => {
    const value = (await fixtureFetcher(path, schema, query)) as { rows: Array<{ summary: string }> };
    return { ...value, rows: value.rows.map((row) => ({ ...row, summary: "🦄" })) } as never;
  };
  const result = await new ArjumSource(fetcher, "arjum", duringRecordedSession).strategies();
  expect(result.data.strategies[0].matches[0].criteria[0]).toEqual({ kind: "unrecognized", flag: "🦄", providerLabel: null });
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('"event":"why_matched_issue"'));
});
