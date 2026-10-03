"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { ChartRangeToggle, useChartRange } from "@/components/charts/chart-range-toggle";
import { DivergingBarChart } from "@/components/charts/diverging-bar-chart";
import { DivergingColumnChart } from "@/components/charts/diverging-column-chart";
import { MultiLineChart } from "@/components/charts/multi-line-chart";
import { DataTable } from "@/components/data/data-table";
import { DataState } from "@/components/feedback/data-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { SectionHeader } from "@/components/layout/section-header";
import { ChartCard } from "@/components/market/chart-card";
import { MetricCard } from "@/components/market/metric-card";
import { OVERVIEW_HISTORY } from "@/components/market/stock-header-live";
import { useBrokerAccumulation, useBrokerSummary, useHistory } from "@/lib/api/hooks";
import type { BrokerRow, HistoryRow } from "@/lib/api/market";
import { sliceByRange } from "@/lib/charts/range";
import { foreignRangeTotals, rangeStartDate } from "@/lib/flow";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatValue, formatVolume, type Locale } from "@/lib/format";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";

export function FlowView({ symbol }: { symbol: string }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [range, setRange] = useChartRange();
  const history = useHistory(symbol, OVERVIEW_HISTORY);
  const brokers = useBrokerSummary(symbol);
  const latestDate = history.data?.data.rows.at(-1)?.date;
  const accumulation = useBrokerAccumulation(symbol, { startDate: latestDate ? rangeStartDate(range, latestDate) : undefined, top: ARJUM_LIMITS.accumulationTop });

  const foreignColumns = useMemo<ColumnDef<HistoryRow, unknown>[]>(() => [
    { accessorKey: "date", header: t("chart.date"), cell: ({ getValue }) => <span className="num">{formatDate(getValue<string>(), locale)}</span> },
    { accessorKey: "foreignBuyShares", header: t("flow.buy"), meta: { numeric: true }, cell: ({ getValue }) => formatVolume(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "foreignSellShares", header: t("flow.sell"), meta: { numeric: true }, cell: ({ getValue }) => formatVolume(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "foreignNetShares", header: t("flow.net"), meta: { numeric: true }, cell: ({ getValue }) => formatVolume(getValue<number>(), locale, { compact: true }) },
  ], [t, locale]);
  const brokerColumns = useMemo<ColumnDef<BrokerRow, unknown>[]>(() => [
    { accessorKey: "code", header: t("broker.code"), cell: ({ row }) => <span className="ticker font-medium" title={row.original.name}>{row.original.code}</span> },
    { accessorKey: "netValueIdr", header: t("broker.net"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "buyValueIdr", header: t("broker.buy"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "sellValueIdr", header: t("broker.sell"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "netVolumeShares", header: t("broker.netVolume"), meta: { numeric: true }, cell: ({ getValue }) => formatVolume(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "netFrequency", header: t("metrics.frequency"), meta: { numeric: true }, cell: ({ getValue }) => formatValue(getValue<number>(), "number", locale) },
  ], [t, locale]);

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="flow-view">
      <DataState query={history} compact>
        {(envelope) => {
          const meta = freshnessMeta(envelope);
          const sliced = sliceByRange(envelope.data.rows, range);
          const totals = foreignRangeTotals(sliced.rows);
          return (
            <section className="flex flex-col gap-3">
              <SectionHeader title={t("flow.foreignTitle")} description={t("flow.foreignDesc")} actions={<ChartRangeToggle value={range} onChange={(next) => void setRange(next)} />} />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <MetricCard label={t("flow.netRange", { sessions: totals.sessions })} value={totals.netShares} format="netSharesCompact" meta={meta} />
                <MetricCard label={t("flow.buySessions")} value={totals.buySessions} format="number" meta={meta} />
                <MetricCard label={t("flow.sellSessions")} value={totals.sellSessions} format="number" meta={meta} />
              </div>
              <ChartCard testId="foreign-chart" title={t("flow.foreignTitle")} meta={meta}
                description={sliced.limited ? t("chart.rangeLimited", { count: envelope.data.rows.length }) : undefined}
                table={<DataTable columns={foreignColumns} data={[...sliced.rows].reverse()} meta={meta} caption={t("flow.foreignTitle")} getRowId={(row) => row.date} maxHeight={360} />}>
                <DivergingColumnChart data={sliced.rows.map((row) => ({ date: row.date, value: row.foreignNetShares }))} format="sharesCompact" ariaLabel={t("flow.foreignDesc")} positiveLabel={t("chart.netBuy")} negativeLabel={t("chart.netSell")} />
              </ChartCard>
            </section>
          );
        }}
      </DataState>

      <div className="grid gap-4 xl:grid-cols-2">
        <DataState query={brokers} compact isEmpty={(envelope) => envelope.data.brokers.length === 0}>
          {(envelope) => {
            const meta = freshnessMeta(envelope);
            const rows = envelope.data.brokers;
            const extremes = [...rows.slice(0, 10), ...rows.slice(-10)].filter((row, index, all) => all.findIndex((other) => other.code === row.code) === index);
            return (
              <ChartCard testId="broker-summary" title={t("flow.brokerTitle")} meta={meta}
                description={t("flow.brokerDesc", { start: formatDate(envelope.data.startDate, locale), end: formatDate(envelope.data.endDate, locale) })}
                table={<DataTable columns={brokerColumns} data={rows} meta={meta} caption={t("flow.brokerTitle")} getRowId={(row) => row.code} maxHeight={400} initialSorting={[{ id: "netValueIdr", desc: true }]} />}>
                <DivergingBarChart data={extremes.map((row) => ({ key: row.code, label: row.code, value: row.netValueIdr }))} format="idrCompact" ariaLabel={t("broker.topNet")} />
              </ChartCard>
            );
          }}
        </DataState>

        <DataState query={accumulation} compact isEmpty={(envelope) => envelope.data.series.length === 0}>
          {(envelope) => {
            const meta = freshnessMeta(envelope);
            const data = envelope.data;
            const list = (items: typeof data.topBuyers) => (items.length ? items.map((row) => `${row.code} ${formatIdr(row.totalNetValueIdr, locale, { compact: true })}`).join(", ") : t("flow.none"));
            return (
              <ChartCard testId="broker-accumulation" title={t("flow.accumulationTitle")} meta={meta}
                description={t("flow.accumulationDesc", { start: formatDate(data.startDate, locale), end: formatDate(data.endDate, locale) })}
                footer={meta.source.startsWith("fixture") ? t("flow.rangeNote") : undefined}
                table={
                  <table className="w-full text-data">
                    <thead><tr className="text-left text-xs text-muted-foreground"><th className="px-cell-x py-cell-y font-medium">{t("flow.broker")}</th><th className="px-cell-x py-cell-y text-right font-medium">{t("flow.total")}</th></tr></thead>
                    <tbody>
                      {data.series.map((series) => (
                        <tr key={series.code} className="h-row border-t border-border">
                          <td className="px-cell-x py-cell-y"><span className="ticker">{series.code}</span> <span className="text-muted-foreground">{series.name}</span></td>
                          <td className="ticker px-cell-x py-cell-y text-right">{formatIdr(series.points.at(-1)?.cumulativeNetValueIdr ?? null, locale, { compact: true })}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }>
                <div className="flex flex-col gap-3">
                  <MultiLineChart series={data.series.map((series) => ({ key: series.code, label: series.name, points: series.points.map((point) => ({ date: point.date, value: point.cumulativeNetValueIdr })) }))} format="idrCompact" ariaLabel={t("flow.accumulationTitle")} />
                  <dl className="grid gap-1 text-xs sm:grid-cols-2">
                    <div><dt className="text-muted-foreground">{t("flow.topBuyers")}</dt><dd className="num">{list(data.topBuyers)}</dd></div>
                    <div><dt className="text-muted-foreground">{t("flow.topSellers")}</dt><dd className="num">{list(data.topSellers)}</dd></div>
                  </dl>
                </div>
              </ChartCard>
            );
          }}
        </DataState>
      </div>
      <ResearchDisclaimer />
    </div>
  );
}
