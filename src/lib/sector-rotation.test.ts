import { describe, expect, it } from "vitest";
import {
  alignCloses, computeRotation, directionVector, minObservations, quadrantOf, RRG_PARAM_DEFAULTS,
  rrgSeries, toWeekly, type ClosePoint, type RrgParams,
} from "./sector-rotation";

// Tiny params make the rolling statistics hand-verifiable.
const P: RrgParams = { smooth: 1, normWindow: 3, momentumWindow: 2, scale: 1 };
const dates = ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04", "2026-01-05", "2026-01-06"];
// benchmark = 1 each day, so rel == sector close.
const rel = [10, 11, 12, 11, 13, 14];

describe("minObservations / quadrant", () => {
  it("derives the warm-up from the methodology: s + N + M − 1", () => {
    expect(minObservations(P)).toBe(5);
    expect(minObservations(RRG_PARAM_DEFAULTS.daily)).toBe(34);
    expect(minObservations(RRG_PARAM_DEFAULTS.weekly)).toBe(20);
  });
  it("classifies quadrants around the 100/100 centre (≥100 = upper/right)", () => {
    expect(quadrantOf(101, 101)).toBe("leading");
    expect(quadrantOf(101, 99)).toBe("weakening");
    expect(quadrantOf(99, 101)).toBe("improving");
    expect(quadrantOf(99, 99)).toBe("lagging");
    expect(quadrantOf(100, 100)).toBe("leading"); // boundary counts as strong+rising
  });
});

describe("rrgSeries — independently computed reference", () => {
  const points = rrgSeries(dates, rel, [1, 1, 1, 1, 1, 1], P);
  it("produces exactly the two points the warm-up allows (6 obs, min 5)", () => {
    expect(points.map((p) => p.date)).toEqual(["2026-01-05", "2026-01-06"]);
  });
  it("matches hand-calculated RS-Ratio / RS-Momentum", () => {
    // idx4: RSR = 100 + (13−12)/0.816497 = 101.224745 ; RSM z of momentum = +1 → 101
    expect(points[0].rsRatio).toBeCloseTo(101.224745, 5);
    expect(points[0].rsMomentum).toBeCloseTo(101, 6);
    expect(points[0].quadrant).toBe("leading");
    // idx5: RSR = 100 + (14−12.666667)/1.247219 = 101.069045 ; RSM z = −1 → 99
    expect(points[1].rsRatio).toBeCloseTo(101.069045, 5);
    expect(points[1].rsMomentum).toBeCloseTo(99, 6);
    expect(points[1].quadrant).toBe("weakening");
  });
  it("is deterministic", () => {
    expect(rrgSeries(dates, rel, [1, 1, 1, 1, 1, 1], P)).toEqual(points);
  });
});

describe("edge cases — no fabricated values", () => {
  it("returns no points when the relative is constant (sd = 0, no division by zero)", () => {
    const flat = rrgSeries(dates, [2, 4, 6, 8, 10, 12], [1, 2, 3, 4, 5, 6], P); // rel == 2 every day
    expect(flat).toEqual([]);
    for (const p of flat) expect(Number.isFinite(p.rsRatio) && Number.isFinite(p.rsMomentum)).toBe(true);
  });
  it("returns nothing below the warm-up (4 obs < min 5)", () => {
    expect(rrgSeries(dates.slice(0, 4), rel.slice(0, 4), [1, 1, 1, 1], P)).toEqual([]);
  });
  it("never emits NaN or Infinity", () => {
    for (const p of rrgSeries(dates, rel, [1, 1, 1, 1, 1, 1], P)) {
      expect(Number.isFinite(p.rsRatio)).toBe(true);
      expect(Number.isFinite(p.rsMomentum)).toBe(true);
    }
  });
});

describe("alignCloses", () => {
  it("intersects on common dates and drops null/non-positive closes", () => {
    const sector: ClosePoint[] = [
      { date: "2026-01-02", close: 11 }, { date: "2026-01-01", close: 10 },
      { date: "2026-01-03", close: null }, { date: "2026-01-04", close: 0 }, { date: "2026-01-05", close: 13 },
    ];
    const bench: ClosePoint[] = [
      { date: "2026-01-01", close: 1 }, { date: "2026-01-02", close: 1 }, { date: "2026-01-05", close: 1 },
      { date: "2026-01-06", close: 1 }, // no sector row → excluded
    ];
    const a = alignCloses(sector, bench);
    expect(a.dates).toEqual(["2026-01-01", "2026-01-02", "2026-01-05"]); // sorted; nulls/0/missing dropped
    expect(a.sector).toEqual([10, 11, 13]);
    expect(a.benchmark).toEqual([1, 1, 1]);
  });
});

describe("directionVector", () => {
  it("points from the previous to the latest point", () => {
    const v = directionVector([
      { date: "a", rsRatio: 100, rsMomentum: 100, quadrant: "leading" },
      { date: "b", rsRatio: 101, rsMomentum: 100, quadrant: "leading" },
    ]);
    expect(v).not.toBeNull();
    expect(v!.dx).toBeCloseTo(1, 6);
    expect(v!.dy).toBeCloseTo(0, 6);
    expect(v!.angleDeg).toBeCloseTo(0, 6);
    expect(v!.velocity).toBeCloseTo(1, 6);
    expect(directionVector([{ date: "a", rsRatio: 100, rsMomentum: 100, quadrant: "leading" }])).toBeNull();
  });
});

describe("toWeekly", () => {
  it("keeps the last close of each ISO week", () => {
    const w = toWeekly([
      { date: "2026-01-05", close: 1 }, // Mon (ISO 2026-W02)
      { date: "2026-01-09", close: 2 }, // Fri (same week) → wins
      { date: "2026-01-12", close: 3 }, // next Mon (W03)
    ]);
    expect(w).toEqual([{ date: "2026-01-09", close: 2 }, { date: "2026-01-12", close: 3 }]);
  });
});

describe("computeRotation — insufficient-data reporting", () => {
  const bench = { id: "COMPOSITE", series: dates.map((d) => ({ date: d, close: 1 })) };
  const sectors = [{ id: "IDXENERGY", name: "Energy", series: dates.map((d, i) => ({ date: d, close: rel[i] })) }];
  it("flags sufficiency against the derived minimum and still returns valid points", () => {
    const r = computeRotation(bench, sectors, "daily", P);
    expect(r.required).toBe(5);
    expect(r.available).toBe(6);
    expect(r.sufficient).toBe(true);
    expect(r.rotations[0].points).toHaveLength(2);
    expect(r.rotations[0].latest?.quadrant).toBe("weakening");
    expect(r.coverage[0]).toEqual({ sectorId: "IDXENERGY", aligned: 6, points: 2 });
  });
  it("reports insufficient without throwing when history is too short", () => {
    const short = { id: "COMPOSITE", series: dates.slice(0, 3).map((d) => ({ date: d, close: 1 })) };
    const shortSec = [{ id: "IDXENERGY", name: "Energy", series: dates.slice(0, 3).map((d, i) => ({ date: d, close: rel[i] })) }];
    const r = computeRotation(short, shortSec, "daily", P);
    expect(r.available).toBe(3);
    expect(r.sufficient).toBe(false);
    expect(r.rotations[0].points).toEqual([]);
    expect(r.rotations[0].latest).toBeNull();
  });
});
