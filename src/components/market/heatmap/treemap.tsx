"use client";

import { useMemo } from "react";
import { stockHref } from "@/components/layout/nav-config";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "@/i18n/navigation";
import type { HeatmapStock } from "@/lib/api/market";
import { colorCap, colorValueOf, intensity, nestedTreemap, sectorKey, sizeOf, summarizeSectors, type ColorMetric, type SizeMetric } from "@/lib/heatmap";
import { cn } from "@/lib/utils";
import { heatColor, StockDetails, useElementWidth, useHeatmapText } from "./shared";

const HEADER = 18;
/** Surface gap between sector groups and between tiles (dataviz spacer rule). */
const GROUP_GAP = 4;
const TILE_GAP = 2;

/**
 * Sector-grouped squarified treemap. Tile area = traded value or |net foreign estimate|; color = change or the net
 * foreign estimate. Every tile is a link to the stock page with a tooltip and an aria-label carrying all its numbers.
 * Stocks without the size measure are left out (the caller says how many).
 */
export function HeatmapTreemap({ stocks, sizeBy, colorBy, height, compact = false, testId = "heatmap-treemap" }: {
  stocks: HeatmapStock[];
  sizeBy: SizeMetric;
  colorBy: ColorMetric;
  height: number;
  /** No sector headers or labels beyond the ticker (home-page preview). */
  compact?: boolean;
  testId?: string;
}) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const text = useHeatmapText();
  const sectorName = text.sector;
  const cap = colorCap(stocks, colorBy);
  const sectors = useMemo(() => new Map(summarizeSectors(stocks).map((row) => [sectorKey(row.sector), row])), [stocks]);
  const layout = useMemo(() => {
    if (width <= 0) return [];
    const groups = new Map<string, { key: string; label: string; items: Array<{ stock: HeatmapStock; value: number }> }>();
    for (const stock of stocks) {
      const value = sizeOf(stock, sizeBy);
      if (value === null) continue;
      const key = sectorKey(stock.sector);
      if (!groups.has(key)) groups.set(key, { key, label: sectorName(stock.sector), items: [] });
      groups.get(key)!.items.push({ stock, value });
    }
    return nestedTreemap([...groups.values()], { x: 0, y: 0, w: width, h: height }, { header: compact ? 0 : HEADER, gap: GROUP_GAP });
  }, [stocks, sizeBy, width, height, compact, sectorName]);

  return (
    <div ref={ref} className="relative w-full overflow-hidden rounded-lg" style={{ height }} data-testid={testId}>
      {layout.map((group) => {
        const sector = sectors.get(group.key);
        return (
          <div key={group.key} role="group" aria-label={text.t("sectorTile", { sector: group.label, count: group.tiles.length, value: text.idr(sector?.valueIdr ?? null), change: text.change(sector?.changePercent ?? null) })}>
            {!compact && group.header && (
              <div aria-hidden className="absolute flex items-center gap-1.5 truncate px-1 text-[11px] leading-none text-soft"
                style={{ left: group.x + GROUP_GAP / 2, top: group.y + GROUP_GAP / 2, width: Math.max(0, group.w - GROUP_GAP), height: HEADER }}>
                <span className="truncate font-medium">{group.label}</span>
                <span className="num shrink-0 text-muted-foreground">{text.change(sector?.changePercent ?? null)}</span>
              </div>
            )}
            {group.tiles.map((tile) => (
              <Tile key={tile.stock.symbol} stock={tile.stock} rect={{ x: tile.x, y: tile.y, w: tile.w, h: tile.h }} level={intensity(colorValueOf(tile.stock, colorBy), cap)} compact={compact} label={text.label(tile.stock)} change={text.change(tile.stock.changePercent)} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Tile({ stock, rect, level, compact, label, change }: { stock: HeatmapStock; rect: { x: number; y: number; w: number; h: number }; level: number | null; compact: boolean; label: string; change: string }) {
  const w = Math.max(0, rect.w - TILE_GAP);
  const h = Math.max(0, rect.h - TILE_GAP);
  const showSymbol = w >= 30 && h >= 14;
  const showChange = !compact && w >= 44 && h >= 34;
  const fontSize = Math.max(10, Math.min(18, Math.min(w / 4.5, h / 2.6)));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link href={stockHref(stock.symbol)} aria-label={label} data-testid={`heatmap-tile-${stock.symbol}`} data-level={level ?? "none"}
          className={cn("absolute flex flex-col items-center justify-center overflow-hidden rounded-[3px] text-center leading-tight text-foreground outline-none",
            "transition-[filter] hover:brightness-110 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring")}
          style={{ left: rect.x + TILE_GAP / 2, top: rect.y + TILE_GAP / 2, width: w, height: h, background: heatColor(level) }}>
          {showSymbol && <span className="ticker font-semibold" style={{ fontSize }}>{stock.symbol}</span>}
          {showChange && <span className="num text-[11px] opacity-90">{change}</span>}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="top"><StockDetails stock={stock} /></TooltipContent>
    </Tooltip>
  );
}
