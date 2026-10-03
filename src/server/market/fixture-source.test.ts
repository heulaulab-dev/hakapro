import { afterEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASELINE_DIR, fixture, wib } from "../../../tests/support/fixtures";
import type { WithFreshness } from "@/lib/freshness";
import { ArjumSource } from "./arjum-source";
import { MarketDataError } from "./errors";
import { clampFixtureFreshness, createFixtureFetcher, defaultFixtureDir, FixtureSource, recordedSymbols } from "./fixture-source";
import type { MarketDataSource } from "./source";

const FIXTURE_SYMBOL = "BBCA";
const fixtureFetcher = createFixtureFetcher(BASELINE_DIR);
const baseline = (clock?: () => Date) => new FixtureSource(clock, BASELINE_DIR);

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
  test.each(arjumCalls(baseline(duringRecordedSession)))("%s is HISTORICAL or UNAVAILABLE, never LIVE/DELAYED", async (_name, call) => {
    const result = await call();
    expect(["HISTORICAL", "UNAVAILABLE"]).toContain(result.freshness);
    expect(result.source).toBe("fixture:arjum");
  });

  test("the clamp matters: the same recorded data through live rules would be DELAYED", async () => {
    const live = new ArjumSource(fixtureFetcher, "arjum", duringRecordedSession);
    expect((await live.strategies()).freshness).toBe("DELAYED");
    expect((await baseline(duringRecordedSession).strategies()).freshness).toBe("HISTORICAL");
  });

  test("clampFixtureFreshness maps every state to HISTORICAL or UNAVAILABLE", () => {
    for (const state of ["LIVE", "DELAYED", "EOD", "HISTORICAL", "STALE"] as const) {
      expect(clampFixtureFreshness(state, "2026-09-18")).toBe("HISTORICAL");
      expect(clampFixtureFreshness(state, null)).toBe("UNAVAILABLE");
    }
    expect(clampFixtureFreshness("UNAVAILABLE", "2026-09-18")).toBe("UNAVAILABLE");
  });

  test("asOf is the data date, not the request time", async () => {
    const result = await baseline(duringRecordedSession).history(FIXTURE_SYMBOL, {});
    expect(result.asOf).toBe("2026-09-18");
    const financials = await baseline(duringRecordedSession).financialStatements(FIXTURE_SYMBOL, {});
    expect(financials).toMatchObject({ asOf: "2026-03-31", period: "Q1 2026", freshness: "HISTORICAL" });
    const seasonality = await baseline(duringRecordedSession).seasonality(FIXTURE_SYMBOL);
    expect(seasonality).toMatchObject({ freshness: "HISTORICAL", asOf: "2026-09", period: "2020-01/2026-09" });
  });

  test("live rules mark financials STALE when the newest period is behind the reporting calendar", async () => {
    const live = new ArjumSource(fixtureFetcher, "arjum", () => wib("2026-10-03T10:00:00"));
    const result = await live.financialStatements(FIXTURE_SYMBOL, {});
    expect(result.freshness).toBe("STALE");
    expect(result.data.reportingLag.behind).toBe(true);
    // Fixture mode caps the label, but the lag itself stays visible in the data.
    const fixtureResult = await baseline(() => wib("2026-10-03T10:00:00")).financialStatements(FIXTURE_SYMBOL, {});
    expect(fixtureResult.freshness).toBe("HISTORICAL");
    expect(fixtureResult.data.reportingLag.behind).toBe(true);
  });
});

describe("fixture coverage is honest", () => {
  test("another symbol is NOT_RECORDED instead of relabelled BBCA data", async () => {
    await expect(baseline().history("BBRI", {})).rejects.toMatchObject({ code: "NOT_RECORDED", status: 404 });
    await expect(baseline().doneDetails("BBRI", {})).rejects.toBeInstanceOf(MarketDataError);
  });

  test("idx-bei capabilities have no recordings and report UNSUPPORTED", async () => {
    await expect(baseline().marketOverview()).rejects.toMatchObject({ code: "UNSUPPORTED" });
  });

  test("search filters the recorded rows", async () => {
    const result = await baseline().search("bbc");
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

describe("manifest-driven dataset", () => {
  test("baseline manifest lists BBCA and every per-stock file it serves", () => {
    expect(recordedSymbols(BASELINE_DIR)).toEqual(["BBCA"]);
  });

  test("defaults to the baseline when no recorded dataset exists", () => {
    const empty = mkdtempSync(join(tmpdir(), "hakapro-fixtures-"));
    expect(defaultFixtureDir(empty)).toBe(join(empty, "fixtures/arjum-baseline"));
    mkdirSync(join(empty, "fixtures/arjum"), { recursive: true });
    writeFileSync(join(empty, "fixtures/arjum/manifest.json"), "{}");
    expect(defaultFixtureDir(empty)).toBe(join(empty, "fixtures/arjum"));
  });

  test("serves any recorded symbol, and refuses a body recorded for a different symbol", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hakapro-fixtures-"));
    const history = fixture<{ stock_code: string }>("history");
    mkdirSync(join(dir, "symbols/SOCI"), { recursive: true });
    mkdirSync(join(dir, "symbols/HRTA"), { recursive: true });
    writeFileSync(join(dir, "symbols/SOCI/history.json"), JSON.stringify({ ...history, stock_code: "SOCI" }));
    writeFileSync(join(dir, "symbols/HRTA/history.json"), JSON.stringify(history)); // mislabelled: body says BBCA
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      provider: "arjum", recordedAt: "2026-10-03T00:00:00Z", screenerDate: null, symbols: ["SOCI", "HRTA"],
      files: [
        { path: "symbols/SOCI/history.json", endpoint: "history", symbol: "SOCI", params: {} },
        { path: "symbols/HRTA/history.json", endpoint: "history", symbol: "HRTA", params: {} },
      ],
    }));
    const source = new FixtureSource(undefined, dir);
    expect((await source.history("SOCI", {})).data.symbol).toBe("SOCI");
    await expect(source.history("HRTA", {})).rejects.toMatchObject({ code: "NOT_RECORDED" });
    await expect(source.history("BBCA", {})).rejects.toMatchObject({ code: "NOT_RECORDED" });
  });

  test("financial statements are looked up by report type", async () => {
    await expect(baseline().financialStatements(FIXTURE_SYMBOL, { reportType: "BALANCE_SHEET" })).rejects.toMatchObject({ code: "NOT_RECORDED" });
    expect((await baseline().financialStatements(FIXTURE_SYMBOL, { reportType: "INCOME_STATEMENT" })).data.reportType).toBe("INCOME_STATEMENT");
  });
});

test("cash flow is requested with the provider's report_type name", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const fetcher = (async (path: string, schema: never, query: Record<string, unknown> = {}) => {
    seen.push(query);
    return fixtureFetcher(path, schema, { ...query, report_type: "INCOME_STATEMENT" });
  }) as unknown as typeof fixtureFetcher;
  await new ArjumSource(fetcher, "arjum", duringRecordedSession).financialStatements(FIXTURE_SYMBOL, { reportType: "CASH_FLOW" });
  expect(seen[0].report_type).toBe("CASH_FLOW_REPORT");
});
