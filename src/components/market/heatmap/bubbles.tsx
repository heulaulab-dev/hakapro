"use client";

import { useMemo } from "react";
import { stockHref } from "@/components/layout/nav-config";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "@/i18n/navigation";
import type { HeatmapStock } from "@/lib/api/market";
import { formatPercent } from "@/lib/format";
import { bubbleLayout, colorCap, colorValueOf, intensity, xTickPosition, yTickPosition, type BubbleY, type ColorMetric } from "@/lib/heatmap";
import { heatColor, StockDetails, useElementWidth, useHeatmapText } from "./shared";

/**
 * Bubble chart: x = change (pp), y = traded value (log) or the net foreign estimate, bubble area ∝ traded value.
 * Axes are SVG; bubbles are positioned links so each has a real href, focus ring, tooltip and aria-label.
 */
export function HeatmapBubbles({ stocks, yBy, colorBy, height }: { stocks: HeatmapStock[]; yBy: BubbleY; colorBy: ColorMetric; height: number }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const text = useHeatmapText();
  const cap = colorCap(stocks, colorBy);
  const scales = useMemo(() => (width > 0 ? bubbleLayout(stocks, yBy, { width, height }) : null), [stocks, yBy, width, height]);

  return (
    <div ref={ref} className="relative w-full" style={{ height }} data-testid="heatmap-bubbles">
      {scales && (
        <>
          <svg aria-hidden width={width} height={height} className="absolute inset-0 overflow-visible">
            {scales.x.ticks.map((tick) => {
              const x = xTickPosition(scales, tick);
              return (
                <g key={`x${tick}`}>
                  <line x1={x} x2={x} y1={scales.plot.y} y2={scales.plot.y + scales.plot.h} stroke="var(--chart-grid)" strokeWidth={tick === 0 ? 1.5 : 1} />
                  <text x={x} y={scales.plot.y + scales.plot.h + 16} textAnchor="middle" className="num fill-muted-foreground text-[10px]">{formatPercent(tick, text.locale, { decimals: Number.isInteger(tick) ? 0 : 1 })}</text>
                </g>
              );
            })}
            {scales.y.ticks.map((tick) => {
              const y = yTickPosition(scales, tick);
              return (
                <g key={`y${tick}`}>
                  <line x1={scales.plot.x} x2={scales.plot.x + scales.plot.w} y1={y} y2={y} stroke="var(--chart-grid)" strokeWidth={!scales.y.log && tick === 0 ? 1.5 : 1} />
                  <text x={scales.plot.x - 6} y={y + 3} textAnchor="end" className="num fill-muted-foreground text-[10px]">{text.idr(tick)}</text>
                </g>
              );
            })}
            <text x={scales.plot.x + scales.plot.w} y={scales.plot.y + scales.plot.h - 6} textAnchor="end" className="fill-muted-foreground text-[10px]">{text.t("xAxis")}</text>
            <text x={scales.plot.x + 4} y={scales.plot.y + 10} className="fill-muted-foreground text-[10px]">{text.t(`y.${yBy}`)}</text>
          </svg>
          {scales.bubbles.map(({ stock, cx, cy, r }) => (
            <Tooltip key={stock.symbol}>
              <TooltipTrigger asChild>
                <Link href={stockHref(stock.symbol)} aria-label={text.label(stock)} data-testid={`heatmap-bubble-${stock.symbol}`}
                  className="absolute flex items-center justify-center rounded-full text-[10px] leading-none text-foreground shadow-[0_0_0_2px_var(--background)] outline-none hover:z-10 focus-visible:z-20 focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ left: cx - r, top: cy - r, width: r * 2, height: r * 2, background: heatColor(intensity(colorValueOf(stock, colorBy), cap)) }}>
                  {r >= 14 && <span className="ticker font-semibold">{stock.symbol}</span>}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top"><StockDetails stock={stock} /></TooltipContent>
            </Tooltip>
          ))}
        </>
      )}
    </div>
  );
}
