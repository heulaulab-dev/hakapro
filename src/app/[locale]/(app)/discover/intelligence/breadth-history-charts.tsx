"use client";

import { useLocale, useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatDate, type Locale } from "@/lib/format";
import type { BreadthHistory } from "@/server/schemas/market-intelligence";

type Point = BreadthHistory["series"][number];

function percent(value: number | null, locale: Locale) {
  return value === null ? "—" : new Intl.NumberFormat(locale === "id" ? "id-ID" : "en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function Trend({ points, dataKey, color, percentAxis = false, testId }: {
  points: Point[]; dataKey: "cumulativePressure" | "aboveSma20Pct" | "advancingValueShare";
  color: string; percentAxis?: boolean; testId: string;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations("intelligence");
  const config = { value: { label: t(dataKey), color } } satisfies ChartConfig;
  const rows = points.map((point) => ({ date: point.date, value: point[dataKey] === null ? null : percentAxis ? point[dataKey]! * 100 : point[dataKey] }));
  return (
    <ChartContainer config={config} className="w-full" style={{ height: 220 }} role="img" aria-label={t(`${dataKey}Chart`)} data-testid={testId}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(date: string) => formatDate(date, locale)} />
        <YAxis width={58} tickLine={false} axisLine={false} domain={percentAxis ? [0, 100] : ["auto", "auto"]} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value: number) => percentAxis ? `${Math.round(value)}%` : `${Math.round(value)} pp`} />
        <ReferenceLine y={percentAxis ? 50 : 0} stroke="var(--border)" strokeDasharray="3 3" />
        <ChartTooltip content={({ active, payload, label }) => {
          const value = payload?.[0]?.value;
          if (!active || value === null || value === undefined) return null;
          return <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
            <div className="num text-muted-foreground">{formatDate(String(label), locale)}</div>
            <div className="num font-medium">{percentAxis ? `${Number(value).toFixed(1)}%` : `${Number(value).toFixed(1)} pp`}</div>
          </div>;
        }} />
        <Line dataKey="value" type="monotone" stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} connectNulls isAnimationActive={false} />
      </LineChart>
    </ChartContainer>
  );
}

export function BreadthHistoryCharts({ data }: { data: BreadthHistory }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("intelligence");
  const points = data.series;
  const latest = points.at(-1);
  const avgEligible = latest?.aboveSma20Eligible ?? 0;
  const valueCoverage = latest?.valueCoverage;
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="breadth-history-charts">
      <section className="rounded-xl border border-border p-3 md:col-span-2" data-testid="breadth-pressure-panel">
        <div className="mb-1"><h3 className="text-sm font-medium">{t("cumulativePressure")}</h3><p className="caption-style text-subtle">{t("cumulativePressureHint")}</p><p className="caption-style text-subtle" data-testid="breadth-movement-coverage">{t("movementCoverage", { comparable: latest?.comparable ?? 0, observed: latest?.observed ?? 0, value: percent(latest?.coverage ?? null, locale) })}</p></div>
        <Trend points={points} dataKey="cumulativePressure" color="var(--series-1)" testId="breadth-pressure-chart" />
      </section>
      <section className="rounded-xl border border-border p-3" data-testid="breadth-sma-panel">
        <div className="mb-1"><h3 className="text-sm font-medium">{t("aboveSma20Pct")}</h3><p className="caption-style text-subtle">{t("aboveSma20Hint", { count: avgEligible })}</p></div>
        <Trend points={points} dataKey="aboveSma20Pct" color="var(--series-2)" percentAxis testId="breadth-sma-chart" />
      </section>
      <section className="rounded-xl border border-border p-3" data-testid="breadth-turnover-panel">
        <div className="mb-1"><h3 className="text-sm font-medium">{t("advancingValueShare")}</h3><p className="caption-style text-subtle">{t("turnoverCoverage", { value: percent(valueCoverage ?? null, locale) })}</p></div>
        <Trend points={points} dataKey="advancingValueShare" color="var(--series-3)" percentAxis testId="breadth-turnover-chart" />
      </section>
    </div>
  );
}
