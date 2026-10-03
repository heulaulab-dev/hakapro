"use client";

import { useLocale, useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatDate, formatValue, type Locale, type ValueFormat } from "@/lib/format";
import { MAX_SERIES, seriesColor } from "./series";

export type LineSeries = { key: string; label: string; points: Array<{ date: string; value: number }> };

/**
 * A few categorical series on one axis (same unit). At most 6 series — callers fold the rest.
 * Legend always shown for ≥ 2 series; tooltip lists every series at the hovered date.
 */
export function MultiLineChart({ series, format, ariaLabel, height = 260 }: { series: LineSeries[]; format: ValueFormat; ariaLabel: string; height?: number }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("chart");
  const shown = series.slice(0, MAX_SERIES);
  const dates = [...new Set(shown.flatMap((item) => item.points.map((point) => point.date)))].sort();
  const rows = dates.map((date) => Object.fromEntries([["date", date], ...shown.map((item) => [item.key, item.points.find((point) => point.date === date)?.value ?? null])]));
  const config = Object.fromEntries(shown.map((item, index) => [item.key, { label: item.label, color: seriesColor(index) }])) satisfies ChartConfig;
  return (
    <div className="flex flex-col gap-2">
      <ChartContainer config={config} className="w-full" style={{ height }} role="img" aria-label={ariaLabel}>
        <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(date: string) => formatDate(date, locale)} />
          <YAxis width={64} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value: number) => formatValue(value, "compact", locale)} />
          <ReferenceLine y={0} stroke="var(--border)" />
          <ChartTooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <div className="flex flex-col gap-1 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
                  <span className="num text-muted-foreground">{t("date")}: {formatDate(String(label), locale)}</span>
                  {payload.map((entry) => (
                    <span key={String(entry.dataKey)} className="num flex items-center gap-1.5">
                      <span aria-hidden className="size-2 rounded-full" style={{ background: entry.color }} />
                      <span className="ticker">{String(entry.dataKey)}</span>
                      <span className="ml-auto pl-3">{formatValue(entry.value as number, format, locale)}</span>
                    </span>
                  ))}
                </div>
              );
            }}
          />
          {shown.map((item, index) => (
            <Line key={item.key} dataKey={item.key} type="monotone" stroke={seriesColor(index)} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} connectNulls isAnimationActive={false} />
          ))}
        </LineChart>
      </ChartContainer>
      {shown.length > 1 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={ariaLabel}>
          {shown.map((item, index) => (
            <li key={item.key} className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: seriesColor(index) }} />
              <span className="ticker text-foreground">{item.key}</span>
              <span className="truncate">{item.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
