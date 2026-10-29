import { describe, expect, it } from "vitest";
import { breadthAtDate, indexReturnAtDate } from "./market-replay";
import type { BreadthHistory } from "@/server/schemas/market-intelligence";
import type { IndicesHistory } from "@/lib/api/market";

const breadth: BreadthHistory = {
  window: "1M", snapshotDate: "2026-10-29", source: "engine", freshness: "EOD",
  series: [
    { date: "2026-10-28", advancers: 10, decliners: 5, unchanged: 2, comparable: 17, observed: 18, coverage: 17 / 18, netAdvanceRate: 5 / 17, cumulativePressure: 4, aboveSma20Pct: 0.6, aboveSma20Eligible: 10, advancingValueIdr: 20, decliningValueIdr: 10, valueObserved: 15, valueCoverage: 15 / 18, advancingValueShare: 2 / 3 },
    { date: "2026-10-29", advancers: 4, decliners: 11, unchanged: 2, comparable: 17, observed: 18, coverage: 17 / 18, netAdvanceRate: -7 / 17, cumulativePressure: -3, aboveSma20Pct: 0.4, aboveSma20Eligible: 10, advancingValueIdr: 8, decliningValueIdr: 22, valueObserved: 15, valueCoverage: 15 / 18, advancingValueShare: 8 / 30 },
  ],
};

const indices: IndicesHistory = {
  series: [
    { code: "COMPOSITE", name: "IHSG", points: [{ date: "2026-10-28", close: 7000 }, { date: "2026-10-29", close: 7100 }] },
    { code: "IDXFINANCE", name: "IDX Finance", points: [{ date: "2026-10-28", close: 1400 }, { date: "2026-10-29", close: 1470 }] },
  ],
};

describe("market replay date alignment", () => {
  it("uses breadth only for the exact selected session", () => {
    expect(breadthAtDate(breadth, "2026-10-29")?.advancers).toBe(4);
    expect(breadthAtDate(breadth, "2026-10-30")).toBeNull();
  });

  it("returns a sector move against the exact shared baseline and session", () => {
    const result = indexReturnAtDate(indices, "IDXFINANCE", "2026-10-28", "2026-10-29");
    expect(result?.close).toBe(1470);
    expect(result?.returnPercent).toBeCloseTo(5, 10);
  });

  it("does not substitute another date or index when either observation is missing", () => {
    expect(indexReturnAtDate(indices, "IDXFINANCE", "2026-10-27", "2026-10-29")).toBeNull();
    expect(indexReturnAtDate(indices, "IDXNONEXISTENT", "2026-10-28", "2026-10-29")).toBeNull();
    expect(indexReturnAtDate(indices, "IDXFINANCE", "2026-10-28", "2026-10-30")).toBeNull();
  });
});
