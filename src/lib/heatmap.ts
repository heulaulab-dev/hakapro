/**
 * Pure helpers for the market heatmap (/discover/heatmap): a squarified treemap layout, filters, sector totals and the
 * bubble-chart scales. No React, no DOM, so every piece is unit-tested (src/lib/heatmap.test.ts).
 *
 * Units follow the client contract (src/lib/api/market.ts): changes in percentage points, values in IDR.
 * `netForeignValueEstimateIdr` is an ESTIMATE ((foreign buy − sell) shares × close) and is null without foreign data.
 */
import type { HeatmapSector, HeatmapStock } from "@/lib/api/market";

/** Mirrors HEATMAP_LIMITS in src/server/schemas/idx-bei.ts (a unit test keeps them equal). */
export const HEATMAP_LIMITS = [30, 50, 100] as const;
export type HeatmapLimit = (typeof HEATMAP_LIMITS)[number];
export const HEATMAP_VIEWS = ["treemap", "bubbles", "pulse"] as const;
export type HeatmapView = (typeof HEATMAP_VIEWS)[number];
export const DIRECTIONS = ["all", "gainers", "losers"] as const;
export type Direction = (typeof DIRECTIONS)[number];
/** Treemap tile area / bubble y-axis: traded value, or the size of the net foreign estimate. */
export const SIZE_METRICS = ["value", "foreign"] as const;
export type SizeMetric = (typeof SIZE_METRICS)[number];
/** Tile and bubble color: the day's change, or the net foreign estimate. */
export const COLOR_METRICS = ["change", "foreign"] as const;
export type ColorMetric = (typeof COLOR_METRICS)[number];
/** URL token for "no sector in the stored universe" (the engine sends a literal null). */
export const NO_SECTOR = "none";
/** Percentage points at which the change color saturates, so colors mean the same across days and filters. */
export const CHANGE_COLOR_CAP = 5;

export type Rect = { x: number; y: number; w: number; h: number };

// ── Squarified treemap (Bruls, Huizing & van Wijk 2000) ───────────────────────────────────────────────────────────

/** Worst aspect ratio of a row of areas laid along a side of length `side`. */
function worst(areas: number[], side: number): number {
  const sum = areas.reduce((a, b) => a + b, 0);
  const max = Math.max(...areas);
  const min = Math.min(...areas);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

/**
 * Lays `items` out in `rect` so each item's area is proportional to its value and tiles stay close to square.
 * Items with a value ≤ 0 (or not finite) are dropped. Largest first; output keeps that order.
 */
export function squarify<T extends { value: number }>(items: T[], rect: Rect): Array<T & Rect> {
  const sorted = items.filter((item) => Number.isFinite(item.value) && item.value > 0).sort((a, b) => b.value - a.value);
  const total = sorted.reduce((sum, item) => sum + item.value, 0);
  if (!sorted.length || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const out: Array<T & Rect> = [];
  let free = { ...rect };
  let row: T[] = [];

  const layRow = (members: T[]) => {
    const areas = members.map((item) => item.value * scale);
    const sum = areas.reduce((a, b) => a + b, 0);
    if (free.w >= free.h) {
      // A column on the left edge.
      const width = Math.min(free.w, sum / free.h);
      let y = free.y;
      members.forEach((item, index) => {
        const h = areas[index] / width;
        out.push({ ...item, x: free.x, y, w: width, h });
        y += h;
      });
      free = { x: free.x + width, y: free.y, w: free.w - width, h: free.h };
    } else {
      // A row along the top edge.
      const height = Math.min(free.h, sum / free.w);
      let x = free.x;
      members.forEach((item, index) => {
        const w = areas[index] / height;
        out.push({ ...item, x, y: free.y, w, h: height });
        x += w;
      });
      free = { x: free.x, y: free.y + height, w: free.w, h: free.h - height };
    }
  };

  for (const item of sorted) {
    const side = Math.min(free.w, free.h);
    const current = row.map((member) => member.value * scale);
    if (!row.length || worst([...current, item.value * scale], side) <= worst(current, side)) row.push(item);
    else {
      layRow(row);
      row = [item];
    }
  }
  if (row.length) layRow(row);
  return out;
}

export type TreemapGroup<T> = { key: string; label: string; items: Array<T & { value: number }> };
export type TreemapGroupLayout<T> = Rect & { key: string; label: string; value: number; header: boolean; tiles: Array<T & { value: number } & Rect> };

/**
 * Two-level treemap: groups (sectors) by their summed value, then each group's items inside it, below a header strip
 * when the group is tall enough to carry one. `gap` insets each group so tiles of different groups never touch.
 */
export function nestedTreemap<T>(groups: Array<TreemapGroup<T>>, rect: Rect, options: { header?: number; gap?: number } = {}): Array<TreemapGroupLayout<T>> {
  const header = options.header ?? 18;
  const gap = options.gap ?? 2;
  const sized = groups.map((group) => ({ ...group, value: group.items.reduce((sum, item) => sum + (item.value > 0 ? item.value : 0), 0) }));
  return squarify(sized, rect).map((group) => {
    const inner = { x: group.x + gap / 2, y: group.y + gap / 2, w: Math.max(0, group.w - gap), h: Math.max(0, group.h - gap) };
    const withHeader = inner.h > header * 2.5 && inner.w > 48;
    const body = withHeader ? { ...inner, y: inner.y + header, h: inner.h - header } : inner;
    return { key: group.key, label: group.label, value: group.value, x: group.x, y: group.y, w: group.w, h: group.h, header: withHeader, tiles: squarify(group.items, body) };
  });
}

// ── Filters and totals ────────────────────────────────────────────────────────────────────────────────────────────

export type HeatmapFilter = { direction: Direction; sector: string | null; query: string };

export const sectorKey = (sector: string | null) => sector ?? NO_SECTOR;

/** Direction, sector (NO_SECTOR = the null sector) and a symbol-prefix or name search. Order is kept. */
export function filterStocks(stocks: HeatmapStock[], filter: HeatmapFilter): HeatmapStock[] {
  const query = filter.query.trim().toUpperCase();
  return stocks.filter((stock) => {
    if (filter.direction === "gainers" && !(stock.changePercent !== null && stock.changePercent > 0)) return false;
    if (filter.direction === "losers" && !(stock.changePercent !== null && stock.changePercent < 0)) return false;
    if (filter.sector !== null && sectorKey(stock.sector) !== filter.sector) return false;
    if (query && !stock.symbol.startsWith(query) && !(stock.name ?? "").toUpperCase().includes(query)) return false;
    return true;
  });
}

export const isFiltered = (filter: HeatmapFilter) => filter.direction !== "all" || filter.sector !== null || filter.query.trim() !== "";

/** Per-sector totals over `stocks`, the same rules as the engine's: largest value first, null sector kept as null. */
export function summarizeSectors(stocks: HeatmapStock[]): HeatmapSector[] {
  const groups = new Map<string | null, HeatmapStock[]>();
  for (const stock of stocks) groups.set(stock.sector, [...(groups.get(stock.sector) ?? []), stock]);
  return [...groups.entries()].map(([sector, members]) => {
    const changes = members.flatMap((row) => (row.changePercent === null ? [] : [row.changePercent]));
    const foreign = members.flatMap((row) => (row.netForeignValueEstimateIdr === null ? [] : [row.netForeignValueEstimateIdr]));
    return {
      sector, stocks: members.length,
      advancers: changes.filter((change) => change > 0).length, decliners: changes.filter((change) => change < 0).length, unchanged: changes.filter((change) => change === 0).length,
      valueIdr: members.reduce((sum, row) => sum + (row.valueIdr ?? 0), 0),
      changePercent: changes.length ? changes.reduce((sum, change) => sum + change, 0) / changes.length : null,
      netForeignValueEstimateIdr: foreign.length ? foreign.reduce((sum, value) => sum + value, 0) : null,
    };
  }).sort((a, b) => b.valueIdr - a.valueIdr || (a.sector ?? "￿").localeCompare(b.sector ?? "￿"));
}

/** Pulse order: highest mean change first; sectors without any change last. */
export function rankSectorsByChange(sectors: HeatmapSector[]): HeatmapSector[] {
  return [...sectors].sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity) || b.valueIdr - a.valueIdr);
}

// ── Metrics and color ─────────────────────────────────────────────────────────────────────────────────────────────

/** Tile area for a stock; null when the metric is missing (the stock is left out of that view, never sized as zero). */
export function sizeOf(stock: HeatmapStock, metric: SizeMetric): number | null {
  const raw = metric === "value" ? stock.valueIdr : stock.netForeignValueEstimateIdr === null ? null : Math.abs(stock.netForeignValueEstimateIdr);
  return raw !== null && raw > 0 ? raw : null;
}

export function colorValueOf(stock: Pick<HeatmapStock, "changePercent" | "netForeignValueEstimateIdr">, metric: ColorMetric): number | null {
  return metric === "change" ? stock.changePercent : stock.netForeignValueEstimateIdr;
}

/** The value at which the color saturates: fixed for change, the largest visible |estimate| for foreign flow. */
export function colorCap(stocks: HeatmapStock[], metric: ColorMetric): number {
  if (metric === "change") return CHANGE_COLOR_CAP;
  const max = Math.max(0, ...stocks.map((stock) => Math.abs(stock.netForeignValueEstimateIdr ?? 0)));
  return max > 0 ? max : 1;
}

/** Signed intensity in [−1, 1] (square-root eased so small moves still read); null stays null. */
export function intensity(value: number | null, cap: number): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (value === 0 || cap <= 0) return 0;
  const share = Math.min(1, Math.abs(value) / cap);
  return Math.sign(value) * Math.sqrt(share);
}

// ── Bubble chart ──────────────────────────────────────────────────────────────────────────────────────────────────

export type BubbleY = SizeMetric;
export type Bubble = { stock: HeatmapStock; cx: number; cy: number; r: number };
export type BubbleScales = {
  bubbles: Bubble[];
  x: { min: number; max: number; ticks: number[] };
  y: { min: number; max: number; ticks: number[]; log: boolean };
  plot: Rect;
};

/** A symmetric "nice" bound ≥ the largest |value| (at least `floor`), so zero sits in the middle. */
export function niceSymmetric(values: number[], floor: number): number {
  const max = Math.max(floor, ...values.map((value) => Math.abs(value)));
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const step = [1, 2, 2.5, 5, 10].find((multiple) => multiple * magnitude >= max)!;
  return step * magnitude;
}

/**
 * x = change (pp, symmetric around 0); y = traded value on a log₁₀ scale, or the net foreign estimate (symmetric,
 * linear); radius ∝ √value so area tracks traded value. Stocks without the x or y measure are left out.
 */
export function bubbleLayout(stocks: HeatmapStock[], yMetric: BubbleY, size: { width: number; height: number }, margin = { top: 12, right: 16, bottom: 28, left: 64 }, maxRadius = 28): BubbleScales {
  const plot = { x: margin.left, y: margin.top, w: Math.max(1, size.width - margin.left - margin.right), h: Math.max(1, size.height - margin.top - margin.bottom) };
  const usable = stocks.filter((stock) => stock.changePercent !== null && (yMetric === "value" ? (stock.valueIdr ?? 0) > 0 : stock.netForeignValueEstimateIdr !== null));
  const xMax = niceSymmetric(usable.map((stock) => stock.changePercent!), 1);
  const x = { min: -xMax, max: xMax, ticks: [-xMax, -xMax / 2, 0, xMax / 2, xMax] };
  let y: BubbleScales["y"];
  if (yMetric === "value") {
    const logs = usable.map((stock) => Math.log10(stock.valueIdr!));
    const min = logs.length ? Math.floor(Math.min(...logs)) : 9;
    const max = logs.length ? Math.max(min + 1, Math.ceil(Math.max(...logs))) : 13;
    y = { min, max, log: true, ticks: Array.from({ length: max - min + 1 }, (_, index) => 10 ** (min + index)) };
  } else {
    const yMax = niceSymmetric(usable.map((stock) => stock.netForeignValueEstimateIdr!), 1);
    y = { min: -yMax, max: yMax, log: false, ticks: [-yMax, -yMax / 2, 0, yMax / 2, yMax] };
  }
  const maxValue = Math.max(1, ...usable.map((stock) => stock.valueIdr ?? 0));
  const px = (value: number) => plot.x + ((value - x.min) / (x.max - x.min)) * plot.w;
  const py = (value: number) => {
    const v = y.log ? Math.log10(value) : value;
    return plot.y + plot.h - ((v - y.min) / (y.max - y.min)) * plot.h;
  };
  const bubbles = usable
    .map((stock) => ({
      stock,
      cx: px(stock.changePercent!),
      cy: py(yMetric === "value" ? stock.valueIdr! : stock.netForeignValueEstimateIdr!),
      r: Math.max(4, Math.sqrt(Math.max(0, stock.valueIdr ?? 0) / maxValue) * maxRadius),
    }))
    // Small bubbles drawn last so a large one never hides them.
    .sort((a, b) => b.r - a.r);
  return { bubbles, x, y: { ...y, ticks: y.ticks }, plot };
}

/** Position of a y tick value on the plot (same mapping as the bubbles). */
export function yTickPosition(scales: BubbleScales, tick: number): number {
  const v = scales.y.log ? Math.log10(tick) : tick;
  return scales.plot.y + scales.plot.h - ((v - scales.y.min) / (scales.y.max - scales.y.min)) * scales.plot.h;
}

export function xTickPosition(scales: BubbleScales, tick: number): number {
  return scales.plot.x + ((tick - scales.x.min) / (scales.x.max - scales.x.min)) * scales.plot.w;
}
