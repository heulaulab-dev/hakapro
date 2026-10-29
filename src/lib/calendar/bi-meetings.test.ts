import { describe, expect, it } from "vitest";
import { bpsEstimateDates } from "./bi-meetings";

describe("BPS release date estimates", () => {
  it("uses the first weekday for monthly inflation and the fifth or next weekday for GDP", () => {
    expect(bpsEstimateDates("2026-10-29")).toEqual([
      { kind: "inflation", date: "2026-11-02" },
      { kind: "gdp", date: "2026-11-05" },
    ]);
  });

  it("keeps release dates inside the three-week estimate window", () => {
    expect(bpsEstimateDates("2026-10-01")).toEqual([{ kind: "inflation", date: "2026-10-01" }]);
  });
});
