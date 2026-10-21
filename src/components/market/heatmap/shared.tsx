"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { HeatmapStock } from "@/lib/api/market";
import { formatDate, formatIdr, formatPercent, formatVolume, type Locale } from "@/lib/format";
import type { FreshnessMeta } from "@/lib/freshness";

/**
 * Diverging market color for a signed intensity in [−1, 1]: --chart-down … neutral … --chart-up, mixed in OKLCH over
 * the muted surface so both themes keep their own steps. Missing data (null) is a hatched texture, never the neutral
 * fill, so "no data" never reads as "unchanged". Market tokens only: brand colors never carry direction.
 */
export function heatColor(level: number | null): string {
  if (level === null) return "repeating-linear-gradient(135deg, var(--muted) 0 4px, var(--card) 4px 8px)";
  const share = Math.round(Math.min(1, Math.abs(level)) * 80);
  if (share === 0) return "var(--muted)";
  return `color-mix(in oklch, var(${level > 0 ? "--chart-up" : "--chart-down"}) ${share}%, var(--muted))`;
}

/** Width of an element, tracked with ResizeObserver (0 until measured, so layouts never run on a guessed size). */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => setWidth(Math.floor(entries[0].contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Formatting shared by every heatmap view (percentage points in, locale text out). */
export function useHeatmapText() {
  const t = useTranslations("heatmap");
  const locale = useLocale() as Locale;
  const change = useCallback((value: number | null) => formatPercent(value, locale), [locale]);
  const idr = useCallback((value: number | null) => formatIdr(value, locale, { compact: true }), [locale]);
  const sector = useCallback((value: string | null) => value ?? t("unknownSector"), [t]);
  const label = useCallback((stock: HeatmapStock) => t("tile", {
    symbol: stock.symbol, name: stock.name ?? stock.symbol, change: change(stock.changePercent), value: idr(stock.valueIdr),
    foreign: idr(stock.netForeignValueEstimateIdr), sector: sector(stock.sector),
  }), [t, change, idr, sector]);
  return { t, locale, change, idr, sector, label };
}

/** Tooltip body for a tile or bubble: every number with its label; the foreign figure is marked as an estimate. */
export function StockDetails({ stock }: { stock: HeatmapStock }) {
  const { t, locale, change, idr, sector } = useHeatmapText();
  const rows: Array<[string, string]> = [
    [t("fields.change"), change(stock.changePercent)],
    [t("fields.price"), formatIdr(stock.close, locale)],
    [t("fields.value"), idr(stock.valueIdr)],
    [t("fields.volume"), formatVolume(stock.volumeShares, locale, { compact: true })],
    [t("fields.foreign"), idr(stock.netForeignValueEstimateIdr)],
    [t("fields.sector"), sector(stock.sector)],
  ];
  return (
    <div className="flex min-w-44 flex-col gap-1 py-0.5">
      <div className="flex items-baseline gap-2">
        <span className="ticker font-semibold text-foreground">{stock.symbol}</span>
        {stock.name && <span className="truncate opacity-80">{stock.name}</span>}
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="opacity-80">{term}</dt>
            <dd className="num text-right text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The visible as-of time and source line every heatmap view carries (the badge holds the same on hover). */
export function AsOfLine({ meta, className }: { meta: FreshnessMeta; className?: string }) {
  const { t, locale } = useHeatmapText();
  return (
    <p className={className ?? "caption-style text-subtle"} data-testid="heatmap-asof">
      <span className="num">{t("asOf", { date: formatDate(meta.asOf, locale) })}</span>
      {meta.source ? <> · {t("source", { source: meta.source })}</> : null}
    </p>
  );
}
