"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { ChartRangeToggle, useChartRange } from "@/components/charts/chart-range-toggle";
import { DivergingBarChart } from "@/components/charts/lazy";
import { DivergingColumnChart } from "@/components/charts/lazy";
import { MultiLineChart } from "@/components/charts/lazy";
import { DataTable } from "@/components/data/data-table";
import { DataState } from "@/components/feedback/data-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { SectionHeader } from "@/components/layout/section-header";
import { ChartCard } from "@/components/market/chart-card";
import { MetricCard } from "@/components/market/metric-card";
import { Segmented } from "@/components/kit/segmented";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { OVERVIEW_HISTORY } from "@/components/market/stock-header-live";
import { useBrokerAccumulation, useBrokerSummary, useHistory } from "@/lib/api/hooks";
import { BROKER_FLOWS, type BrokerLevel, type BrokerRow, type HistoryRow } from "@/lib/api/market";
import { sliceByRange } from "@/lib/charts/range";
import { foreignRangeTotals, rangeStartDate } from "@/lib/flow";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatValue, formatVolume, type Locale } from "@/lib/format";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";

const BROKER_PERIODS = ["session", "range"] as const;
/** Broker list sizes; 200 is the provider maximum and covers every IDX broker. */
const BROKER_COUNTS = ["20", "50", "200"] as const;
const BROKER_CODE = /^[A-Z0-9]{2}$/;

export function FlowView({ symbol }: { symbol: string }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [range, setRange] = useChartRange();
  const [brokerPeriod, setBrokerPeriod] = useQueryState("bperiod", parseAsStringLiteral(BROKER_PERIODS).withDefault("session"));
  const [flow, setFlow] = useQueryState("bflow", parseAsStringLiteral(BROKER_FLOWS).withDefault("all"));
  const [net, setNet] = useQueryState("bnet", parseAsBoolean.withDefault(false));
  const [count, setCount] = useQueryState("bcount", parseAsStringLiteral(BROKER_COUNTS).withDefault("20"));
  const [brokerFilter, setBrokerFilter] = useQueryState("acc", parseAsString);
  const [filterInput, setFilterInput] = useState(brokerFilter ?? "");
  const history = useHistory(symbol, OVERVIEW_HISTORY);
  const latestDate = history.data?.data.rows.at(-1)?.date;
  const rangeStart = latestDate ? rangeStartDate(range, latestDate) : undefined;
  // "session" leaves the dates to the provider (its latest session); "range" follows the chart range.
  const brokers = useBrokerSummary(symbol, {
    ...(brokerPeriod === "range" && rangeStart && latestDate ? { startDate: rangeStart, endDate: latestDate } : {}),
    flow, net, brokerLimit: Number(count), levelLimit: Number(count),
  }, { enabled: brokerPeriod === "session" || Boolean(latestDate) });
  const accumulationBrokers = brokerFilter ? brokerFilter.split(",").filter((code) => BROKER_CODE.test(code)) : undefined;
  const accumulation = useBrokerAccumulation(symbol, { startDate: rangeStart, top: ARJUM_LIMITS.accumulationTop, brokers: accumulationBrokers });

  function applyBrokerFilter(event: FormEvent) {
    event.preventDefault();
    const codes = [...new Set(filterInput.toUpperCase().split(/[\s,]+/).filter((code) => BROKER_CODE.test(code)))];
    setFilterInput(codes.join(", "));
    void setBrokerFilter(codes.length ? codes.join(",") : null);
  }

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
  const levelColumns = useMemo<ColumnDef<BrokerLevel, unknown>[]>(() => [
    { accessorKey: "rank", header: "#", meta: { numeric: true }, cell: ({ getValue }) => <span className="num text-muted-foreground">{getValue<number>()}</span> },
    { id: "buyer", header: t("flow.levels.buyer"), cell: ({ row }) => row.original.buy ? <span className="ticker font-medium" title={row.original.buy.name}>{row.original.buy.code}</span> : "—" },
    { id: "buyValue", header: t("flow.levels.value"), meta: { numeric: true }, cell: ({ row }) => formatIdr(row.original.buy?.valueIdr ?? null, locale, { compact: true }) },
    { id: "buyAverage", header: t("flow.levels.average"), meta: { numeric: true }, cell: ({ row }) => formatIdr(row.original.buy?.averagePriceIdr ?? null, locale) },
    { id: "seller", header: t("flow.levels.seller"), cell: ({ row }) => row.original.sell ? <span className="ticker font-medium" title={row.original.sell.name}>{row.original.sell.code}</span> : "—" },
    { id: "sellValue", header: t("flow.levels.value"), meta: { numeric: true }, cell: ({ row }) => formatIdr(row.original.sell?.valueIdr ?? null, locale, { compact: true }) },
    { id: "sellAverage", header: t("flow.levels.average"), meta: { numeric: true }, cell: ({ row }) => formatIdr(row.original.sell?.averagePriceIdr ?? null, locale) },
  ], [t, locale]);

  const brokerControls = (
    <div className="flex flex-wrap items-center gap-2" data-testid="broker-controls">
      <Segmented value={brokerPeriod} onChange={(value) => void setBrokerPeriod(value === "session" ? null : value)}
        options={BROKER_PERIODS.map((value) => ({ value, label: <span data-testid={`broker-period-${value}`}>{t(`flow.periods.${value}`)}</span> }))} />
      <ToggleGroup type="single" size="sm" variant="outline" value={flow} onValueChange={(value) => value && void setFlow(value === "all" ? null : value as typeof flow)} aria-label={t("flow.flowLabel")}>
        {BROKER_FLOWS.map((value) => <ToggleGroupItem key={value} value={value} className="px-2.5 text-xs" data-testid={`broker-flow-${value}`}>{t(`flow.flows.${value}`)}</ToggleGroupItem>)}
      </ToggleGroup>
      <Button variant={net ? "secondary" : "ghost"} size="sm" aria-pressed={net} onClick={() => void setNet(net ? null : true)} data-testid="broker-net">{t("flow.netOnly")}</Button>
      <Select value={count} onValueChange={(value) => void setCount(value === "20" ? null : value as typeof count)}>
        <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("flow.countLabel")} data-testid="broker-count"><SelectValue /></SelectTrigger>
        <SelectContent>{BROKER_COUNTS.map((value) => <SelectItem key={value} value={value}>{value === "200" ? t("flow.countAll") : t("flow.count", { count: Number(value) })}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );

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
                table={<DataTable mobile="cards" columns={foreignColumns} data={[...sliced.rows].reverse()} meta={meta} caption={t("flow.foreignTitle")} getRowId={(row) => row.date} maxHeight={360} />}>
                <DivergingColumnChart data={sliced.rows.map((row) => ({ date: row.date, value: row.foreignNetShares }))} format="sharesCompact" ariaLabel={t("flow.foreignDesc")} positiveLabel={t("chart.netBuy")} negativeLabel={t("chart.netSell")} />
              </ChartCard>
            </section>
          );
        }}
      </DataState>

      <section className="flex flex-col gap-3">
        <SectionHeader title={t("flow.brokerTitle")} description={t("flow.brokerIntro")} actions={brokerControls} />
        <DataState query={brokers} compact isEmpty={(envelope) => envelope.data.brokers.length === 0}>
          {(envelope) => {
            const meta = freshnessMeta(envelope);
            const data = envelope.data;
            const rows = data.brokers;
            const extremes = [...rows.slice(0, 10), ...rows.slice(-10)].filter((row, index, all) => all.findIndex((other) => other.code === row.code) === index);
            const scope = `${t(`flow.flows.${data.flow}`)}${data.net ? ` · ${t("flow.netOnly")}` : ""}`;
            return (
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <ChartCard testId="broker-summary" title={t("flow.brokerTitle")} meta={meta}
                  description={t("flow.brokerDesc", { start: formatDate(data.startDate, locale), end: formatDate(data.endDate, locale), scope })}
                  footer={t("flow.available", { from: formatDate(data.availableFrom, locale), to: formatDate(data.availableTo, locale) })}
                  table={<DataTable mobile="cards" columns={brokerColumns} data={rows} meta={meta} caption={t("flow.brokerTitle")} getRowId={(row) => row.code} maxHeight={400} initialSorting={[{ id: "netValueIdr", desc: true }]} />}>
                  <DivergingBarChart data={extremes.map((row) => ({ key: row.code, label: row.code, value: row.netValueIdr }))} format="idrCompact" ariaLabel={t("broker.topNet")} />
                </ChartCard>
                <section className="flex flex-col gap-2" data-testid="broker-levels">
                  <SectionHeader as="h3" title={t("flow.levels.title")} description={t(data.net ? "flow.levels.descNet" : "flow.levels.desc")} />
                  <DataTable columns={levelColumns} data={data.levels} meta={meta} caption={t("flow.levels.title")} getRowId={(row) => String(row.rank)} maxHeight={400}
                    empty={t("flow.levels.empty")} />
                </section>
              </div>
            );
          }}
        </DataState>
      </section>

      <div className="grid grid-cols-1 gap-4">

        <DataState query={accumulation} compact isEmpty={(envelope) => envelope.data.series.length === 0}>
          {(envelope) => {
            const meta = freshnessMeta(envelope);
            const data = envelope.data;
            const list = (items: typeof data.topBuyers) => (items.length ? items.map((row) => `${row.code} ${formatIdr(row.totalNetValueIdr, locale, { compact: true })}`).join(", ") : t("flow.none"));
            return (
              <ChartCard testId="broker-accumulation" title={t("flow.accumulationTitle")} meta={meta}
                description={t("flow.accumulationDesc", { start: formatDate(data.startDate, locale), end: formatDate(data.endDate, locale) })}
                actions={
                  <form onSubmit={applyBrokerFilter} className="flex items-center gap-1.5" data-testid="accumulation-filter">
                    <label className="sr-only" htmlFor="accumulation-brokers">{t("flow.brokerFilter")}</label>
                    <Input id="accumulation-brokers" value={filterInput} onChange={(event) => setFilterInput(event.target.value)} placeholder={t("flow.brokerFilterPlaceholder")} className="ticker h-8 w-40 text-xs uppercase" autoComplete="off" />
                    <Button type="submit" variant="outline" size="sm">{t("flow.apply")}</Button>
                  </form>
                }
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
                  <dl className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
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
