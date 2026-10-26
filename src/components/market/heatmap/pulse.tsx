"use client";

import { ChangeValue } from "@/components/market/change-value";
import type { HeatmapSector } from "@/lib/api/market";
import { intensity, rankSectorsByChange, sectorKey } from "@/lib/heatmap";
import { heatColor, useHeatmapText } from "./shared";

/**
 * Sector pulse: one row per sector, ranked by mean change, with a diverging bar (scaled to the largest |mean|), the
 * breadth split (up / unchanged / down, counts in text) and traded value. Picking a row narrows the map to it.
 */
export function HeatmapPulse({ sectors, onPick }: { sectors: HeatmapSector[]; onPick?: (sectorKey: string) => void }) {
  const text = useHeatmapText();
  const ranked = rankSectorsByChange(sectors);
  const scale = Math.max(0.5, ...ranked.map((row) => Math.abs(row.changePercent ?? 0)));
  return (
    <ul className="flex flex-col divide-y divide-border" data-testid="heatmap-pulse">
      {ranked.map((row) => {
        const name = text.sector(row.sector);
        const change = row.changePercent;
        const share = change === null ? 0 : (Math.abs(change) / scale) * 50;
        const known = row.advancers + row.decliners + row.unchanged;
        return (
          <li key={sectorKey(row.sector)} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 py-2 text-sm sm:grid-cols-[minmax(8rem,14rem)_minmax(6rem,1fr)_4.5rem_minmax(7rem,10rem)_9rem]" data-testid={`heatmap-pulse-${sectorKey(row.sector)}`}>
            {onPick ? (
              <button type="button" onClick={() => onPick(sectorKey(row.sector))} aria-label={text.t("pulse.only", { sector: name })}
                className="min-w-0 truncate text-left text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring">{name}</button>
            ) : <span className="min-w-0 truncate">{name}</span>}
            {/* Diverging bar around a centre line: left = down, right = up. */}
            <div aria-hidden className="relative order-3 col-span-2 h-2.5 rounded-sm bg-muted/40 sm:order-none sm:col-span-1">
              <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
              {change !== null && change !== 0 && (
                <div className="absolute inset-y-0 rounded-sm" style={{ [change > 0 ? "left" : "right"]: "50%", width: `${share}%`, background: heatColor(intensity(change, scale)) }} />
              )}
            </div>
            <span className="order-2 text-right sm:order-none">
              <span className="sr-only">{text.t("pulse.average")} </span><ChangeValue percent={change} />
            </span>
            <div className="order-4 col-span-2 flex flex-col gap-1 sm:order-none sm:col-span-1">
              <div aria-hidden className="flex h-1.5 overflow-hidden rounded-full bg-muted/40">
                {known > 0 && (
                  <>
                    <div style={{ width: `${(row.advancers / known) * 100}%`, background: "var(--chart-up)" }} />
                    <div style={{ width: `${(row.unchanged / known) * 100}%`, background: "var(--muted-foreground)" }} />
                    <div style={{ width: `${(row.decliners / known) * 100}%`, background: "var(--chart-down)" }} />
                  </>
                )}
              </div>
              <span className="num text-[11px] text-muted-foreground">{text.t("pulse.breadth", { adv: row.advancers, dec: row.decliners, unch: row.unchanged })}</span>
            </div>
            <span className="num order-5 col-span-2 whitespace-nowrap text-[11px] text-muted-foreground sm:order-none sm:col-span-1 sm:text-right">
              {text.t("pulse.stocks", { count: row.stocks })} · {text.idr(row.valueIdr)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
