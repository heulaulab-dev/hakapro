"use client";

import { useLocale, useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatDate, formatShortDate, formatValue, type Locale, type ValueFormat } from "@/lib/format";

export type DatedValue = { date: string; value: number };

/**
 * Daily values around a zero baseline (e.g. net foreign flow). Up = above, down = below; color is
 * redundant with position. Columns ≤ 24px with a 4px rounded data end.
 */
export function DivergingColumnChart({ data, format, ariaLabel, height = 220, positiveLabel, negativeLabel, formatX }: {
  data: DatedValue[];
  format: ValueFormat;
  ariaLabel: string;
  height?: number;
  positiveLabel: string;
  negativeLabel: string;
  /** X labels; defaults to short dates. Pass identity for non-date categories (e.g. "Q1 2026"). */
  formatX?: (key: string) => string;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("chart");
  const config = { value: { label: ariaLabel } } satisfies ChartConfig;
  return (
    <ChartContainer config={config} className="w-full" style={{ height }} role="img" aria-label={ariaLabel}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 4 }} barCategoryGap="20%">
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={24} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(key: string) => (formatX ? formatX(key) : formatShortDate(key, locale))} />
        <YAxis width={56} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value: number) => formatValue(value, "compact", locale)} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <ChartTooltip
          cursor={{ fill: "var(--accent)", opacity: 0.4 }}
          content={({ active, payload }) => {
            const datum = active ? (payload?.[0]?.payload as DatedValue | undefined) : undefined;
            if (!datum) return null;
            return (
              <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
                <div className="num text-muted-foreground">{formatX ? formatX(datum.date) : `${t("date")}: ${formatDate(datum.date, locale)}`}</div>
                <div className="num">{datum.value >= 0 ? positiveLabel : negativeLabel}: {formatValue(datum.value, format, locale)}</div>
              </div>
            );
          }}
        />
        <Bar dataKey="value" maxBarSize={24} isAnimationActive={false}>
          {data.map((datum) => (
            <Cell key={datum.date} fill={datum.value >= 0 ? "var(--chart-up)" : "var(--chart-down)"} radius={(datum.value >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4]) as unknown as number} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
