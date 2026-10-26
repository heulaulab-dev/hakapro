"use client";

import { CHANGE_COLOR_CAP, type ColorMetric } from "@/lib/heatmap";
import { heatColor, useHeatmapText } from "./shared";

const STOPS = [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1];

/** Diverging legend for the active color metric, with its saturation point and the "no data" texture. */
export function HeatmapLegend({ colorBy, cap }: { colorBy: ColorMetric; cap: number }) {
  const text = useHeatmapText();
  const low = colorBy === "change" ? text.t("legend.down") : text.t("legend.netSell");
  const high = colorBy === "change" ? text.t("legend.up") : text.t("legend.netBuy");
  const capText = colorBy === "change" ? text.t("legend.cap", { value: `${CHANGE_COLOR_CAP}%` }) : text.t("legend.foreignCap", { value: text.idr(cap) });
  // Each stop is its own color-mix (CSS gradients cannot interpolate between color-mix() results in every browser).
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground" data-testid="heatmap-legend">
      <span>▼ {low}</span>
      <div aria-hidden className="flex h-2.5 w-40 overflow-hidden rounded-sm">
        {STOPS.map((stop) => <div key={stop} className="flex-1" style={{ background: heatColor(stop) }} />)}
      </div>
      <span>▲ {high}</span>
      <span className="flex items-center gap-1"><span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: heatColor(null) }} />{text.t("legend.noData")}</span>
      <span>{capText}</span>
    </div>
  );
}
