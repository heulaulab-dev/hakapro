"use client";

/*
 * TradingView Lightweight Charts™
 * Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/
 * (Apache-2.0; attribution logo kept on, see THIRD_PARTY_NOTICES.md)
 */
import { CandlestickSeries, ColorType, createChart, HistogramSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { HistoryRow } from "@/lib/api/market";
import { observeTheme, resolveCssColor } from "@/lib/charts/colors";
import { formatCompact, formatDate, formatIdr, formatNumber, formatVolume, type Locale } from "@/lib/format";

const toTime = (date: string) => (Date.parse(`${date}T00:00:00Z`) / 1000) as UTCTimestamp;

/** Daily candles with a separate volume pane (no dual axis). Crosshair readout above the plot. */
export function PriceChart({ rows, height = 320 }: { rows: HistoryRow[]; height?: number }) {
  const t = useTranslations("chart");
  const locale = useLocale() as Locale;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{ candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram"> } | null>(null);
  const [hovered, setHovered] = useState<HistoryRow | null>(null);
  const latest = rows.at(-1) ?? null;
  const rowsRef = useRef(rows);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: { attributionLogo: true, background: { type: ColorType.Solid, color: "transparent" }, fontFamily: "var(--font-geist-mono)", fontSize: 11 },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 0 },
      localization: { locale: locale === "id" ? "id-ID" : "en-US" },
    });
    // Formatters live on each series: a chart-wide priceFormatter would override the volume pane's compact format.
    const candles = chart.addSeries(CandlestickSeries, { borderVisible: false, priceLineVisible: false, priceFormat: { type: "custom", minMove: 1, formatter: (price: number) => formatNumber(price, locale, { decimals: 0 }) } });
    const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: "custom", formatter: (shares: number) => formatCompact(shares, locale) }, priceLineVisible: false, lastValueVisible: false }, 1);
    chart.panes()[1]?.setHeight(Math.round(height * 0.22));
    chartRef.current = chart;
    seriesRef.current = { candles, volume };

    const paint = () => {
      const up = resolveCssColor(container, "--chart-up");
      const down = resolveCssColor(container, "--chart-down");
      const grid = resolveCssColor(container, "--chart-grid");
      const text = resolveCssColor(container, "--muted-foreground");
      chart.applyOptions({
        layout: { textColor: text, panes: { separatorColor: grid, separatorHoverColor: grid, enableResize: false } },
        grid: { vertLines: { color: "transparent" }, horzLines: { color: grid, style: 0 } },
        crosshair: { vertLine: { color: text, labelBackgroundColor: text }, horzLine: { color: text, labelBackgroundColor: text } },
      });
      candles.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down });
      volume.applyOptions({ color: resolveCssColor(container, "--neutral", 0.45) });
    };
    paint();
    const stopObserving = observeTheme(paint);

    chart.subscribeCrosshairMove((param) => {
      const time = typeof param.time === "number" ? param.time : null;
      setHovered(time === null ? null : (rowsRef.current.find((row) => toTime(row.date) === time) ?? null));
    });
    return () => {
      stopObserving();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [height, locale]);

  useEffect(() => {
    rowsRef.current = rows;
    const series = seriesRef.current;
    if (!series) return;
    series.candles.setData(rows.map((row) => ({ time: toTime(row.date), open: row.open, high: row.high, low: row.low, close: row.close })));
    series.volume.setData(rows.map((row) => ({ time: toTime(row.date), value: row.volumeShares })));
    chartRef.current?.timeScale().fitContent();
  }, [rows, height, locale]);

  const shown = hovered ?? latest;
  return (
    <div className="flex flex-col gap-2">
      <dl className="num flex flex-wrap gap-x-4 gap-y-1 text-xs" aria-live="polite" data-testid="price-readout">
        {shown && (
          <>
            <div className="flex gap-1"><dt className="text-muted-foreground">{t("date")}</dt><dd>{formatDate(shown.date, locale)}</dd></div>
            <div className="flex gap-1"><dt className="text-muted-foreground">{t("open")}</dt><dd className="ticker">{formatIdr(shown.open, locale)}</dd></div>
            <div className="flex gap-1"><dt className="text-muted-foreground">{t("high")}</dt><dd className="ticker">{formatIdr(shown.high, locale)}</dd></div>
            <div className="flex gap-1"><dt className="text-muted-foreground">{t("low")}</dt><dd className="ticker">{formatIdr(shown.low, locale)}</dd></div>
            <div className="flex gap-1"><dt className="text-muted-foreground">{t("close")}</dt><dd className="ticker">{formatIdr(shown.close, locale)}</dd></div>
            <div className="flex gap-1"><dt className="text-muted-foreground">{t("volume")}</dt><dd className="ticker">{formatVolume(shown.volumeShares, locale, { compact: true })}</dd></div>
          </>
        )}
      </dl>
      <div ref={containerRef} style={{ height }} data-testid="price-chart" className="w-full" />
    </div>
  );
}
