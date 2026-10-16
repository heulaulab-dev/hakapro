// Refresh cycles of the fundamentals job, the FX lookup of the ratios job and Pasardana's ratio rows.
import { describe, expect, it } from "vitest";
import { fixture, wib } from "../../test/support";
import { parseGetAll } from "../sources/pasardana";
import { expectedQuarterEnd, fundamentalsCycle, inEarningsWindow, weekStart } from "./fundamentals";
import { fxLookup } from "./ratios";
import { pasardanaRatioRows } from "./universe";

describe("fundamentals refresh cycles", () => {
  it("runs one full pass per ISO week (Monday, WIB)", () => {
    expect(weekStart("2026-10-12")).toBe("2026-10-12"); // Monday
    expect(weekStart("2026-10-16")).toBe("2026-10-12"); // Friday
    expect(weekStart("2026-10-18")).toBe("2026-10-12"); // Sunday
    expect(weekStart("2026-10-19")).toBe("2026-10-19");
    // 23:30 WIB on Sunday is still that week; 00:30 WIB Monday starts the next one.
    expect(fundamentalsCycle(wib("2026-10-18", "23:30")).full).toBe("2026-10-12");
    expect(fundamentalsCycle(wib("2026-10-19", "00:30")).full).toBe("2026-10-19");
  });

  it("opens the catch-up pass from Thursday to Sunday inside the filing windows", () => {
    expect(inEarningsWindow("2026-03-15")).toBe(true);
    expect(inEarningsWindow("2026-05-10")).toBe(true);
    expect(inEarningsWindow("2026-05-11")).toBe(false);
    expect(inEarningsWindow("2026-08-01")).toBe(true);
    expect(inEarningsWindow("2026-10-16")).toBe(true);
    expect(inEarningsWindow("2026-12-01")).toBe(false);
    expect(fundamentalsCycle(wib("2026-10-14", "20:05")).catchup).toBeNull(); // Wednesday
    expect(fundamentalsCycle(wib("2026-10-16", "20:05"))).toEqual({ full: "2026-10-12", catchup: "2026-10-12-catchup", expectedQuarter: "2026-06-30" });
    expect(fundamentalsCycle(wib("2026-10-25", "20:05"))).toMatchObject({ catchup: "2026-10-19-catchup", expectedQuarter: "2026-09-30" });
    expect(fundamentalsCycle(wib("2026-12-03", "20:05")).catchup).toBeNull();
  });

  it("expects a quarter three weeks after it ends", () => {
    expect(expectedQuarterEnd("2026-10-20")).toBe("2026-06-30");
    expect(expectedQuarterEnd("2026-10-21")).toBe("2026-09-30");
    expect(expectedQuarterEnd("2026-01-10")).toBe("2025-09-30");
    expect(expectedQuarterEnd("2026-01-21")).toBe("2025-12-31");
  });
});

describe("ratio job helpers", () => {
  it("converts USD with the newest JISDOR on or before the price date", () => {
    const fx = fxLookup([{ date: "2026-10-14", value: 17_900 }, { date: "2026-10-15", value: 17_948 }, { date: "2026-10-17", value: 18_000 }], "2026-10-16");
    expect(fx("IDR")).toEqual({ rate: 1, date: null });
    expect(fx("USD")).toEqual({ rate: 17_948, date: "2026-10-15" });
    expect(fx("SGD")).toBeNull();
    expect(fxLookup([], "2026-10-16")("USD")).toBeNull();
  });

  it("stores Pasardana's own PER/PBV/ROE with provenance; non-positive multiples become null with a note", () => {
    const prov = { source: "pasardana", asOf: new Date("2026-10-16T09:40:00Z"), rawRef: "doc-1" };
    const rows = parseGetAll(fixture("pasardana-getall.json")).rows;
    const { upserts } = pasardanaRatioRows(rows, prov);
    expect(upserts.filter((row) => row.symbol === "AADI")).toEqual([
      { symbol: "AADI", ratio: "per", value: 6.17137, date: "2026-10-15", basis: "pasardana:Per", note: null, inputs: { Per: 6.17137 }, derivation: null, ...prov },
      { symbol: "AADI", ratio: "pbv", value: 1.25254, date: "2026-10-15", basis: "pasardana:Pbr", note: null, inputs: { Pbr: 1.25254 }, derivation: null, ...prov },
      { symbol: "AADI", ratio: "roe", value: 0.24083955408348, date: "2026-10-15", basis: "pasardana:Roe", note: null, inputs: { Roe: 0.24083955408348 }, derivation: null, ...prov },
    ]);
    const loss = pasardanaRatioRows([{ ...rows[0], symbol: "GOTO", ratios: { per: -40.2, pbv: null, roe: -0.03 } }], prov);
    expect(loss.upserts).toEqual([
      expect.objectContaining({ symbol: "GOTO", ratio: "per", value: null, note: "NON_POSITIVE_SOURCE_VALUE", inputs: { Per: -40.2 } }),
      expect.objectContaining({ symbol: "GOTO", ratio: "roe", value: -0.03, note: null }),
    ]);
    expect(loss.removed).toEqual([{ symbol: "GOTO", ratio: "pbv" }]);
    // Without a data date nothing is stored.
    expect(pasardanaRatioRows([{ ...rows[0], date: null }], prov)).toEqual({ upserts: [], removed: [] });
  });
});
