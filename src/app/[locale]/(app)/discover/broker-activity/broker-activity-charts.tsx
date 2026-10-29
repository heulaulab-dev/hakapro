"use client";

import { useLocale, useTranslations } from "next-intl";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { formatDate, type Locale } from "@/lib/format";
import type { BrokerActivityModel } from "@/lib/broker-activity";
import { seriesColor } from "@/components/charts/series";

export function BrokerActivityCharts({ data }: { data: BrokerActivityModel }) {
  const locale = useLocale() as Locale;
  const t = useTranslations("brokerActivity");
  const shownCodes = data.raceCodes;
  const config = Object.fromEntries(shownCodes.map((broker, index) => [`broker${index}`, {
    label: broker.name ? `${broker.code} · ${broker.name}` : broker.code,
    color: seriesColor(index),
  }])) satisfies ChartConfig;
  const rows = data.race.map((day) => ({ date: day.date, ...Object.fromEntries(day.shares.map((share, index) => [`broker${index}`, share])) }));
  const hasRaceValues = rows.some((row) => shownCodes.some((_, index) => row[`broker${index}` as keyof typeof row] !== null && row[`broker${index}` as keyof typeof row] !== undefined));
  const topFiveConfig = { share: { label: t("topFiveShare"), color: seriesColor(0) } } satisfies ChartConfig;
  const concentrationRows = data.concentration.map((day) => ({ date: day.date, share: day.topFiveSharePercent }));
  const hasConcentration = concentrationRows.some((row) => row.share !== null);

  return <div className="grid gap-5 xl:grid-cols-2" data-testid="broker-activity-charts">
    <section className="flex min-w-0 flex-col gap-2" aria-labelledby="broker-race-title">
      <div><h2 id="broker-race-title" className="text-sm font-semibold">{t("raceTitle")}</h2><p className="caption-style text-subtle">{t("raceDescription")}</p></div>
      {hasRaceValues ? <>
        <ChartContainer config={config} className="w-full" style={{ height: 260 }} role="img" aria-label={t("raceAccessible")}>
          <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
            <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(date: string) => formatDate(date, locale)} />
            <YAxis width={48} domain={[0, "auto"]} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value: number) => `${value.toFixed(0)}%`} />
            <ChartTooltip content={({ active, payload, label }) => !active || !payload?.length ? null : (
              <div className="flex flex-col gap-1 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
                <span className="num text-muted-foreground">{formatDate(String(label), locale)}</span>
                {payload.filter((entry) => entry.value !== null).map((entry) => <span key={String(entry.dataKey)} className="num flex items-center gap-2">
                  <span aria-hidden className="size-2 rounded-full" style={{ background: entry.color }} />{config[String(entry.dataKey)]?.label ?? entry.dataKey}<strong className="ml-auto">{Number(entry.value).toFixed(2)}%</strong>
                </span>)}
              </div>
            )} />
            {shownCodes.map((broker, index) => <Line key={broker.code} dataKey={`broker${index}`} name={broker.code} type="monotone" stroke={seriesColor(index)} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} connectNulls={false} isAnimationActive={false} />)}
          </LineChart>
        </ChartContainer>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t("raceAccessible")}>
          {shownCodes.map((broker, index) => <li key={broker.code} className="flex items-center gap-1.5"><span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: seriesColor(index) }} /><span className="ticker text-foreground">{broker.code}</span><span className="truncate">{broker.name}</span></li>)}
        </ul>
      </> : <p className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-sm text-subtle">{t("noChartData")}</p>}
    </section>

    <section className="flex min-w-0 flex-col gap-2" aria-labelledby="broker-concentration-title">
      <div><h2 id="broker-concentration-title" className="text-sm font-semibold">{t("concentrationTitle")}</h2><p className="caption-style text-subtle">{t("concentrationDescription")}</p></div>
      {hasConcentration ? <ChartContainer config={topFiveConfig} className="w-full" style={{ height: 260 }} role="img" aria-label={t("concentrationAccessible")}>
        <LineChart data={concentrationRows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} minTickGap={32} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(date: string) => formatDate(date, locale)} />
          <YAxis width={48} domain={[0, 100]} tickLine={false} axisLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 11 }} tickFormatter={(value: number) => `${value.toFixed(0)}%`} />
          <ChartTooltip content={({ active, payload, label }) => !active || !payload?.length || payload[0]?.value == null ? null : (
            <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm"><span className="num text-muted-foreground">{formatDate(String(label), locale)}</span><div className="num font-semibold">{t("topFiveShare")}: {Number(payload[0].value).toFixed(2)}%</div></div>
          )} />
          <Line dataKey="share" type="monotone" stroke={seriesColor(0)} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ChartContainer> : <p className="flex h-48 items-center justify-center rounded-lg border border-dashed border-border text-center text-sm text-subtle">{t("concentrationUnavailable")}</p>}
    </section>
  </div>;
}
