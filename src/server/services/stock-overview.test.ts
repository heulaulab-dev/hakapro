import { describe, expect, test } from "vitest";
import { BASELINE_DIR, wib } from "../../../tests/support/fixtures";
import { FixtureSource } from "@/server/market/fixture-source";
import { getStockOverview } from "./stock-overview";

const source = () => new FixtureSource(() => wib("2026-10-03T10:00:00"), BASELINE_DIR);

describe("stock overview aggregation", () => {
  test("BBCA: every recorded section is ok with its own freshness", async () => {
    const result = await getStockOverview(source(), "BBCA");
    expect(result.freshness).toBe("HISTORICAL");
    expect(result.asOf).toBe("2026-09-18");
    for (const key of ["price", "foreignFlow", "brokers", "ownership", "financials"] as const) {
      expect(result.data[key].status, key).toBe("ok");
    }
    expect(result.data.financials).toMatchObject({ status: "ok", period: "Q1 2026", data: { behind: true } });
  });

  test("an unrecorded symbol yields per-section errors, not numbers", async () => {
    const result = await getStockOverview(source(), "SOCI");
    expect(result.freshness).toBe("UNAVAILABLE");
    expect(result.data.price).toEqual({ status: "error", error: "NOT_RECORDED" });
    expect(result.data.ownership).toEqual({ status: "error", error: "NOT_RECORDED" });
  });
});
