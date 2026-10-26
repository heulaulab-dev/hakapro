"use client";

/*
 * TradingView Lightweight Charts™
 * Copyright (с) 2025 TradingView, Inc. https://www.tradingview.com/
 * (Apache-2.0; attribution logo kept on, see THIRD_PARTY_NOTICES.md)
 */
import { CandlestickSeries, ColorType, createChart, HistogramSeries, LineSeries, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { HistoryRow } from "@/lib/api/market";
import { observeTheme, resolveCssColor } from "@/lib/charts/colors";
import { formatCompact, formatDate, formatIdr, formatNumber, formatVolume, type Locale } from "@/lib/format";
import type { MacdPoint } from "@/lib/indicators";
import { SERIES_TOKENS } from "./series";

export type PriceOverlay = { key: string; label: string; points: Array<{ time: string; value: number }> };

const toTime = (date: string) => (Date.parse(`${date}T00:00:00Z`) / 1000) as UTCTimestamp;

/**
 * Daily candles with a separate volume pane (no dual axis). Optional same-unit overlays (e.g. SMA)
 * in categorical series colors with a legend, and an optional MACD pane. Crosshair readout above.
 */
export function PriceChart({ rows, height = 320, overlays = [], macd }: { rows: HistoryRow[]; height?: number; overlays?: PriceOverlay[]; macd?: MacdPoint[] }) {
  const t = useTranslations("chart");
  const locale = useLocale() as Locale;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{ candles: ISeriesApi<"Candlestick">; volume: ISeriesApi<"Histogram"> } | null>(null);
  const [hovered, setHovered] = useState<HistoryRow | null>(null);
  const latest = rows.at(-1) ?? null;
  const rowsRef = useRef(rows);
  // Bumped on theme/density changes so overlay series repaint with the new token colors.
  const [themeTick, setThemeTick] = useState(0);
  useEffect(() => observeTheme(() => setThemeTick((tick) => tick + 1)), []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      autoSize: true,
      layout: { attributionLogo: true, background: { type: ColorType.Solid, color: "transparent" }, fontFamily: "var(--font-geist-mono)", fontSize: 11 },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, fixLeftEdge: true, fixRightEdge: true },
      crosshair: { mode: 0 },
      // A vertical swipe over the chart scrolls the page; only horizontal drags pan the time axis.
      handleScroll: { vertTouchDrag: false },
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

  // Overlays and the MACD pane are rebuilt when their inputs change.
  useEffect(() => {
    const chart = chartRef.current;
    const container = containerRef.current;
    if (!chart || !container) return;
    const added: Array<ISeriesApi<"Line"> | ISeriesApi<"Histogram">> = [];
    overlays.forEach((overlay, index) => {
      const line = chart.addSeries(LineSeries, { color: resolveCssColor(container, SERIES_TOKENS[index % SERIES_TOKENS.length]), lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      line.setData(overlay.points.map((point) => ({ time: toTime(point.time), value: point.value })));
      added.push(line);
    });
    if (macd?.length) {
      const histogram = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, priceFormat: { type: "custom", minMove: 0.01, formatter: (value: number) => formatNumber(value, locale, { decimals: 1 }) } }, 2);
      const up = resolveCssColor(container, "--chart-up", 0.6);
      const down = resolveCssColor(container, "--chart-down", 0.6);
      histogram.setData(macd.map((point) => ({ time: toTime(point.time), value: point.histogram, color: point.histogram >= 0 ? up : down })));
      const macdLine = chart.addSeries(LineSeries, { color: resolveCssColor(container, SERIES_TOKENS[overlays.length % SERIES_TOKENS.length]), lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 2);
      macdLine.setData(macd.map((point) => ({ time: toTime(point.time), value: point.macd })));
      const signalLine = chart.addSeries(LineSeries, { color: resolveCssColor(container, SERIES_TOKENS[(overlays.length + 1) % SERIES_TOKENS.length]), lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 2);
      signalLine.setData(macd.map((point) => ({ time: toTime(point.time), value: point.signal })));
      added.push(histogram, macdLine, signalLine);
      chart.panes()[2]?.setHeight(Math.round(height * 0.25));
    }
    return () => {
      for (const series of added) {
        try { chart.removeSeries(series); } catch { /* chart already removed */ }
      }
    };
  }, [overlays, macd, height, locale, themeTick]);

  const shown = hovered ?? latest;
  return (
    <div className="flex flex-col gap-2">
      <dl className="num grid grid-cols-3 gap-x-3 gap-y-1 text-xs sm:flex sm:flex-wrap sm:gap-x-4" aria-live="polite" data-testid="price-readout">
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
      <div ref={containerRef} style={{ height: macd?.length ? Math.round(height * 1.3) : height }} data-testid="price-chart" className="w-full" />
      {(overlays.length > 0 || Boolean(macd?.length)) && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" data-testid="chart-legend">
          {overlays.map((overlay, index) => (
            <li key={overlay.key} className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: `var(${SERIES_TOKENS[index % SERIES_TOKENS.length]})` }} />{overlay.label}</li>
          ))}
          {macd?.length ? (
            <>
              {/* MACD lines take the next categorical slots so no color means two things in one chart. */}
              <li className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: `var(${SERIES_TOKENS[overlays.length % SERIES_TOKENS.length]})` }} />MACD (12, 26)</li>
              <li className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: `var(${SERIES_TOKENS[(overlays.length + 1) % SERIES_TOKENS.length]})` }} />Signal (9)</li>
            </>
          ) : null}
        </ul>
      )}
    </div>
  );
}
