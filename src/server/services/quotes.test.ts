import { expect, test } from "vitest";
import { BASELINE_DIR, wib } from "../../../tests/support/fixtures";
import { leastFresh } from "@/lib/freshness";
import { FixtureSource } from "@/server/market/fixture-source";
import { getQuotes } from "./quotes";

test("leastFresh picks the stalest state", () => {
  expect(leastFresh(["EOD", "DELAYED", "STALE"])).toBe("STALE");
  expect(leastFresh(["EOD", "HISTORICAL"])).toBe("HISTORICAL");
  expect(leastFresh([])).toBe("UNAVAILABLE");
});

test("quotes: recorded symbols resolve, unrecorded ones report why, order is kept", async () => {
  const result = await getQuotes(new FixtureSource(() => wib("2026-10-03T10:00:00"), BASELINE_DIR), ["BBCA", "SOCI"]);
  expect(result.data[0]).toMatchObject({ symbol: "BBCA", status: "ok", close: 6300, changePercent: -0.79, freshness: "HISTORICAL", asOf: "2026-09-18" });
  expect(result.data[1]).toEqual({ symbol: "SOCI", status: "error", error: "NOT_RECORDED" });
  expect(result).toMatchObject({ freshness: "HISTORICAL", asOf: "2026-09-18" });
});

test("quotes: nothing resolvable is UNAVAILABLE", async () => {
  const result = await getQuotes(new FixtureSource(undefined, BASELINE_DIR), ["SOCI"]);
  expect(result).toMatchObject({ freshness: "UNAVAILABLE", asOf: null });
});
