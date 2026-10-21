import { describe, expect, it } from "vitest";
import { HEATMAP_LIMITS as SERVER_LIMITS } from "@/server/schemas/idx-bei";
import type { HeatmapStock } from "@/lib/api/market";
import {
  bubbleLayout, colorCap, filterStocks, HEATMAP_LIMITS, intensity, isFiltered, NO_SECTOR, nestedTreemap, niceSymmetric, rankSectorsByChange, sizeOf, squarify,
  summarizeSectors, xTickPosition, yTickPosition, type Rect,
} from "./heatmap";

const stock = (symbol: string, extra: Partial<HeatmapStock> = {}): HeatmapStock => ({
  symbol, name: `${symbol} Tbk`, sector: "Finance", close: 1000, changePercent: 1, valueIdr: 1e9, volumeShares: 1e6, netForeignValueEstimateIdr: null, ...extra,
});
const area = (rect: Rect) => rect.w * rect.h;
const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - 1e-9 && inner.y >= outer.y - 1e-9 && inner.x + inner.w <= outer.x + outer.w + 1e-9 && inner.y + inner.h <= outer.y + outer.h + 1e-9;
const overlaps = (a: Rect, b: Rect) => a.x + a.w - 1e-9 > b.x && b.x + b.w - 1e-9 > a.x && a.y + a.h - 1e-9 > b.y && b.y + b.h - 1e-9 > a.y;

describe("squarify", () => {
  const bounds = { x: 0, y: 0, w: 600, h: 400 };
  const items = [6, 6, 4, 3, 2, 2, 1].map((value, index) => ({ id: `s${index}`, value }));

  it("fills the rectangle with areas proportional to value, without overlaps", () => {
    const tiles = squarify(items, bounds);
    expect(tiles).toHaveLength(7);
    const total = items.reduce((sum, item) => sum + item.value, 0);
    for (const tile of tiles) {
      expect(area(tile)).toBeCloseTo((tile.value / total) * area(bounds), 6);
      expect(inside(tile, bounds)).toBe(true);
    }
    expect(tiles.reduce((sum, tile) => sum + area(tile), 0)).toBeCloseTo(area(bounds), 6);
    for (let i = 0; i < tiles.length; i += 1) for (let j = i + 1; j < tiles.length; j += 1) expect(overlaps(tiles[i], tiles[j]), `${i}/${j}`).toBe(false);
  });

  it("keeps tiles close to square (the paper's example worst ratio)", () => {
    const tiles = squarify(items, { x: 0, y: 0, w: 6, h: 4 });
    const worst = Math.max(...tiles.map((tile) => Math.max(tile.w / tile.h, tile.h / tile.w)));
    expect(worst).toBeLessThan(3);
    // Largest first.
    expect(tiles.map((tile) => tile.value)).toEqual([6, 6, 4, 3, 2, 2, 1]);
  });

  it("drops non-positive values and handles empty input or an empty rectangle", () => {
    expect(squarify([{ value: 0 }, { value: -3 }, { value: Number.NaN }], bounds)).toEqual([]);
    expect(squarify([], bounds)).toEqual([]);
    expect(squarify([{ value: 1 }], { x: 0, y: 0, w: 0, h: 10 })).toEqual([]);
    expect(squarify([{ value: 5 }], bounds)).toEqual([{ value: 5, ...bounds }]);
  });
});

describe("nestedTreemap", () => {
  it("lays groups by summed value, then tiles inside each group below its header", () => {
    const bounds = { x: 0, y: 0, w: 800, h: 500 };
    const groups = nestedTreemap([
      { key: "A", label: "A", items: [{ id: "a1", value: 30 }, { id: "a2", value: 10 }] },
      { key: "B", label: "B", items: [{ id: "b1", value: 20 }] },
      { key: "C", label: "C", items: [{ id: "c1", value: 0 }] },
    ], bounds, { header: 18, gap: 2 });
    expect(groups.map((group) => [group.key, group.value])).toEqual([["A", 40], ["B", 20]]);
    for (const group of groups) {
      expect(group.header).toBe(true);
      for (const tile of group.tiles) {
        expect(inside(tile, group)).toBe(true);
        expect(tile.y).toBeGreaterThanOrEqual(group.y + 18);
      }
    }
    expect(area(groups[0])).toBeCloseTo(area(bounds) * (40 / 60), 6);
  });
});

describe("filters and sector totals", () => {
  const stocks = [
    stock("BBCA", { changePercent: 1.5, valueIdr: 5e12, netForeignValueEstimateIdr: 2e10 }),
    stock("BBRI", { changePercent: -2, valueIdr: 3e12, netForeignValueEstimateIdr: -5e10 }),
    stock("GOTO", { sector: "Technology", changePercent: 0, valueIdr: 1e12, name: "GoTo Gojek Tokopedia" }),
    stock("XXXX", { sector: null, changePercent: null, valueIdr: 2e11 }),
  ];

  it("filters by direction, sector (including the null sector) and search", () => {
    const all = { direction: "all" as const, sector: null, query: "" };
    expect(filterStocks(stocks, all)).toHaveLength(4);
    expect(isFiltered(all)).toBe(false);
    expect(filterStocks(stocks, { ...all, direction: "gainers" }).map((row) => row.symbol)).toEqual(["BBCA"]);
    expect(filterStocks(stocks, { ...all, direction: "losers" }).map((row) => row.symbol)).toEqual(["BBRI"]);
    expect(filterStocks(stocks, { ...all, sector: "Finance" }).map((row) => row.symbol)).toEqual(["BBCA", "BBRI"]);
    expect(filterStocks(stocks, { ...all, sector: NO_SECTOR }).map((row) => row.symbol)).toEqual(["XXXX"]);
    expect(filterStocks(stocks, { ...all, query: "bb" }).map((row) => row.symbol)).toEqual(["BBCA", "BBRI"]);
    expect(filterStocks(stocks, { ...all, query: "gojek" }).map((row) => row.symbol)).toEqual(["GOTO"]);
    expect(isFiltered({ ...all, query: " x " })).toBe(true);
  });

  it("totals sectors like the engine: null sector kept, mean change over known changes, foreign null without data", () => {
    const sectors = summarizeSectors(stocks);
    expect(sectors.map((row) => [row.sector, row.stocks, row.valueIdr])).toEqual([["Finance", 2, 8e12], ["Technology", 1, 1e12], [null, 1, 2e11]]);
    expect(sectors[0]).toMatchObject({ advancers: 1, decliners: 1, changePercent: -0.25, netForeignValueEstimateIdr: -3e10 });
    expect(sectors[1]).toMatchObject({ unchanged: 1, changePercent: 0, netForeignValueEstimateIdr: null });
    expect(sectors[2]).toMatchObject({ changePercent: null, advancers: 0, decliners: 0, unchanged: 0 });
    expect(rankSectorsByChange(sectors).map((row) => row.sector)).toEqual(["Technology", "Finance", null]);
  });

  it("sizes by value or |net foreign estimate|, never sizing a missing measure as zero", () => {
    expect(sizeOf(stocks[1], "value")).toBe(3e12);
    expect(sizeOf(stocks[1], "foreign")).toBe(5e10);
    expect(sizeOf(stocks[2], "foreign")).toBeNull();
    expect(colorCap(stocks, "foreign")).toBe(5e10);
    expect(colorCap(stocks, "change")).toBe(5);
  });
});

describe("color intensity", () => {
  it("is signed, eased, capped, and null for missing data", () => {
    expect(intensity(null, 5)).toBeNull();
    expect(intensity(0, 5)).toBe(0);
    expect(intensity(5, 5)).toBe(1);
    expect(intensity(-50, 5)).toBe(-1);
    expect(intensity(1.25, 5)).toBeCloseTo(0.5, 10);
  });
});

describe("bubble layout", () => {
  const stocks = [
    stock("AAAA", { changePercent: 3, valueIdr: 1e12, netForeignValueEstimateIdr: 4e9 }),
    stock("BBBB", { changePercent: -1, valueIdr: 1e10, netForeignValueEstimateIdr: -1e9 }),
    stock("CCCC", { changePercent: null, valueIdr: 1e11 }),
  ];

  it("places change on a symmetric x axis and value on a log y axis; bubble area tracks value", () => {
    const scales = bubbleLayout(stocks, "value", { width: 600, height: 400 });
    expect(scales.bubbles.map((bubble) => bubble.stock.symbol)).toEqual(["AAAA", "BBBB"]);
    expect(scales.x).toMatchObject({ min: -5, max: 5 });
    expect(scales.y).toMatchObject({ min: 10, max: 12, log: true, ticks: [1e10, 1e11, 1e12] });
    const [big, small] = scales.bubbles;
    expect(big.cx).toBeCloseTo(xTickPosition(scales, 3), 9);
    expect(big.cy).toBeCloseTo(yTickPosition(scales, 1e12), 9);
    expect(big.cy).toBeLessThan(small.cy);
    expect(big.r).toBe(28);
    expect(small.r).toBeCloseTo(Math.max(4, Math.sqrt(0.01) * 28), 9);
  });

  it("uses a symmetric linear y for the net foreign estimate and leaves out stocks without it", () => {
    const scales = bubbleLayout(stocks, "foreign", { width: 600, height: 400 });
    expect(scales.bubbles.map((bubble) => bubble.stock.symbol)).toEqual(["AAAA", "BBBB"]);
    expect(scales.y).toMatchObject({ min: -5e9, max: 5e9, log: false });
    expect(yTickPosition(scales, 0)).toBeCloseTo(scales.plot.y + scales.plot.h / 2, 9);
  });

  it("rounds symmetric bounds up to a nice value", () => {
    expect(niceSymmetric([0.3], 1)).toBe(1);
    expect(niceSymmetric([-7, 2], 1)).toBe(10);
    expect(niceSymmetric([2.2], 1)).toBe(2.5);
  });
});

describe("limits", () => {
  it("match the engine's", () => {
    expect([...HEATMAP_LIMITS]).toEqual([...SERVER_LIMITS]);
  });
});
