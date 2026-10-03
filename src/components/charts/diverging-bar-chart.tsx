"use client";

import { useLocale, useTranslations } from "next-intl";
import { Bar, BarChart, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatValue, type Locale, type ValueFormat } from "@/lib/format";

export type DivergingDatum = { key: string; label: string; value: number };

const BAR_SIZE = 16;

/**
 * Horizontal bars from a zero baseline: right = net buy (up), left = net sell (down). Polarity is
 * encoded by side of baseline + sign in the tooltip, not by color alone. Bars ≤ 24px, 4px rounded
 * data end, square at the baseline.
 */
export function DivergingBarChart({ data, format, ariaLabel }: { data: DivergingDatum[]; format: ValueFormat; ariaLabel: string }) {
  const t = useTranslations("chart");
  const locale = useLocale() as Locale;
  const config = { value: { label: ariaLabel } } satisfies ChartConfig;
  const height = Math.max(160, data.length * (BAR_SIZE + 10) + 40);
  return (
    <ChartContainer config={config} className="w-full" style={{ height }} role="img" aria-label={ariaLabel}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 4 }} barCategoryGap={4}>
        <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value: number) => formatValue(value, "compact", locale)} />
        <YAxis type="category" dataKey="label" width={44} tickLine={false} axisLine={false} tick={{ fill: "var(--foreground)", fontSize: 11, fontFamily: "var(--font-geist-mono)" }} />
        <ReferenceLine x={0} stroke="var(--border)" />
        <ChartTooltip
          cursor={{ fill: "var(--accent)", opacity: 0.4 }}
          content={({ active, payload }) => {
            const datum = active ? (payload?.[0]?.payload as DivergingDatum | undefined) : undefined;
            if (!datum) return null;
            return (
              <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
                <div className="ticker font-medium">{datum.label}</div>
                <div className="num">
                  <span className="text-muted-foreground">{datum.value >= 0 ? t("netBuy") : t("netSell")}: </span>
                  {formatValue(datum.value, format, locale)}
                </div>
              </div>
            );
          }}
        />
        <Bar dataKey="value" maxBarSize={BAR_SIZE} isAnimationActive={false}>
          {data.map((datum) => (
            <Cell key={datum.key} fill={datum.value >= 0 ? "var(--chart-up)" : "var(--chart-down)"} radius={(datum.value >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4]) as unknown as number} />
          ))}
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
