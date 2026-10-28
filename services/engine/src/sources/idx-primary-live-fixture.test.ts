import { describe, expect, it } from "vitest";
import response from "./idx-index-summary.2026-10-26.fixture.json";
import { parseIdxIndexSummary } from "./idx-primary";

describe("GetIndexSummary captured IDX response contract", () => {
  it("retains all five previously missing IDX-IC sector codes", () => {
    const parsed = parseIdxIndexSummary(response, "2026-10-26");
    const sectors = ["IDXNONCYC", "IDXCYCLIC", "IDXTECHNO", "IDXINFRA", "IDXTRANS"];

    for (const code of sectors) {
      expect(parsed.rows.find((row) => row.code === code)).toMatchObject({ code, date: "2026-10-26" });
      expect(parsed.rows.find((row) => row.code === code)!.close).toBeGreaterThan(0);
    }
  });

  it("normalizes the captured 45-row DataTables response, including Highest/Lowest fields", () => {
    expect(response.recordsTotal).toBe(45);
    const parsed = parseIdxIndexSummary(response, "2026-10-26");
    expect(parsed.rejected).toEqual([]);
    expect(parsed.rows).toHaveLength(45);
    expect(parsed.rows.find((row) => row.code === "COMPOSITE")).toMatchObject({
      date: "2026-10-26", open: null, high: 5453.647, low: 5349.754, close: 5373.094, previousClose: 5439.258,
    });
    expect(parsed.rows.find((row) => row.code === "IDXENERGY")).toMatchObject({
      high: 2746.133, low: 2645.498, close: 2649.144,
    });
  });
});
