"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { SeasonalityHeatmap } from "@/components/charts/seasonality-heatmap";
import { DataTable } from "@/components/data/data-table";
import { DataState } from "@/components/feedback/data-state";
import { SectionHeader } from "@/components/layout/section-header";
import { OVERVIEW_HISTORY } from "@/components/market/stock-header-live";
import { useDoneDetails, useHistory, useSeasonality } from "@/lib/api/hooks";
import type { DoneDetailRow, HistoryRow } from "@/lib/api/market";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatPercent, formatValue, formatVolume, type Locale } from "@/lib/format";

export function HistoryView({ symbol }: { symbol: string }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const history = useHistory(symbol, OVERVIEW_HISTORY);
  const seasonality = useSeasonality(symbol);
  const tape = useDoneDetails(symbol);
  const historyColumns = useMemo<ColumnDef<HistoryRow, unknown>[]>(() => [
    { accessorKey: "date", header: t("chart.date"), cell: ({ getValue }) => <span className="num whitespace-nowrap">{formatDate(getValue<string>(), locale)}</span> },
    { accessorKey: "open", header: t("chart.open"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale) },
    { accessorKey: "high", header: t("chart.high"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale) },
    { accessorKey: "low", header: t("chart.low"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale) },
    { accessorKey: "close", header: t("chart.close"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale) },
    { accessorKey: "changePercent", header: t("metrics.change"), meta: { numeric: true }, cell: ({ getValue }) => formatPercent(getValue<number>(), locale) },
    { accessorKey: "volumeShares", header: t("chart.volume"), meta: { numeric: true }, cell: ({ getValue }) => formatVolume(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "valueIdr", header: t("metrics.value"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "frequency", header: t("metrics.frequency"), meta: { numeric: true }, cell: ({ getValue }) => formatValue(getValue<number>(), "number", locale) },
    { accessorKey: "foreignNetShares", header: t("metrics.foreignNet"), meta: { numeric: true }, cell: ({ getValue }) => formatVolume(getValue<number>(), locale, { compact: true, signed: true }) },
  ], [t, locale]);
  const tapeColumns = useMemo<ColumnDef<DoneDetailRow, unknown>[]>(() => [
    { accessorKey: "time", header: t("stockHistory.time"), cell: ({ getValue }) => <span className="num">{getValue<string>()}</span> },
    { accessorKey: "priceIdr", header: t("chart.close"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale) },
    { accessorKey: "lots", header: "Lot", meta: { numeric: true }, cell: ({ getValue }) => formatValue(getValue<number>(), "number", locale) },
    { accessorKey: "valueIdr", header: t("metrics.value"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "buyer", header: t("stockHistory.buyer"), cell: ({ row }) => <span className="ticker">{row.original.buyer}<span className="ml-1 text-muted-foreground">{row.original.buyerType}</span></span> },
    { accessorKey: "seller", header: t("stockHistory.seller"), cell: ({ row }) => <span className="ticker">{row.original.seller}<span className="ml-1 text-muted-foreground">{row.original.sellerType}</span></span> },
    { accessorKey: "board", header: t("stockHistory.board"), cell: ({ getValue }) => <span className="ticker text-muted-foreground">{getValue<string>()}</span> },
    { accessorKey: "aggressor", header: t("stockHistory.aggressor"), cell: ({ getValue }) => <span className="ticker">{getValue<string>()}</span> },
  ], [t, locale]);

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="history-view">
      <section className="flex flex-col gap-3">
        <SectionHeader title={t("stockHistory.title")} />
        <DataState query={history}>
          {(envelope) => <DataTable testId="history-table" columns={historyColumns} data={[...envelope.data.rows].reverse()} meta={freshnessMeta(envelope)} caption={t("stockHistory.title")} getRowId={(row) => row.date} maxHeight={420} />}
        </DataState>
      </section>
      <DataState query={seasonality} compact>{(envelope) => <SeasonalityHeatmap data={envelope.data} meta={freshnessMeta(envelope)} />}</DataState>
      <DataState query={tape} compact>
        {(envelope) => (
          <section className="flex flex-col gap-2">
            <SectionHeader title={t("stockHistory.tape", { date: formatDate(envelope.data.date, locale) })} description={t("stockHistory.tapeNote", { total: formatValue(envelope.data.total, "number", locale) })} />
            <DataTable testId="tape-table" columns={tapeColumns} data={envelope.data.rows} meta={freshnessMeta(envelope)} caption={t("stockHistory.tape", { date: envelope.data.date })} maxHeight={360} />
          </section>
        )}
      </DataState>
    </div>
  );
}
