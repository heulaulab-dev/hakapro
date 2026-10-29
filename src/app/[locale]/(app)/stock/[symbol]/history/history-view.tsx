"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type FormEvent } from "react";
import { SeasonalityHeatmap } from "@/components/charts/lazy";
import { DataTable } from "@/components/data/data-table";
import { DataState } from "@/components/feedback/data-state";
import { SectionHeader } from "@/components/layout/section-header";
import { OVERVIEW_HISTORY } from "@/components/market/stock-header-live";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";
import { useDoneDetails, useHistory, useSeasonality } from "@/lib/api/hooks";
import type { DoneDetailRow, HistoryRow } from "@/lib/api/market";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatPercent, formatValue, formatVolume, type Locale } from "@/lib/format";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LATEST = "latest";

export function HistoryView({ symbol }: { symbol: string }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [from, setFrom] = useQueryState("from", parseAsString);
  const [to, setTo] = useQueryState("to", parseAsString);
  const [draft, setDraft] = useState({ from: from ?? "", to: to ?? "" });
  const [tapeDate, setTapeDate] = useQueryState("tdate", parseAsString);
  const [tapePage, setTapePage] = useQueryState("tpage", parseAsInteger.withDefault(1));
  const ranged = Boolean(from || to);
  // The default view shares the header's query; a date range asks the provider for exactly that span.
  const overview = useHistory(symbol, OVERVIEW_HISTORY);
  const filtered = useHistory(symbol, { frame: "daily", limit: ARJUM_LIMITS.historyRows, startDate: from ?? undefined, endDate: to ?? undefined }, { enabled: ranged });
  const history = ranged ? filtered : overview;
  const seasonality = useSeasonality(symbol);
  const tape = useDoneDetails(symbol, tapeDate, tapePage);
  // Trade dates offered for the tape: sessions in the loaded history, newest first.
  const sessions = useMemo(() => [...(overview.data?.data.rows ?? [])].reverse().slice(0, 60).map((row) => row.date), [overview.data]);

  function applyRange(event: FormEvent) {
    event.preventDefault();
    const start = ISO_DATE.test(draft.from) ? draft.from : null;
    const end = ISO_DATE.test(draft.to) ? draft.to : null;
    if (start && end && start > end) return;
    void setFrom(start);
    void setTo(end);
  }
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
        <SectionHeader title={t("stockHistory.title")}
          description={overview.data?.data.available ? t("stockHistory.available", { from: formatDate(overview.data.data.available.from, locale), to: formatDate(overview.data.data.available.to, locale) }) : undefined}
          actions={
            <form onSubmit={applyRange} className="grid w-full grid-cols-2 items-end gap-2 sm:flex sm:w-auto sm:flex-wrap" data-testid="history-range">
              <label className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">{t("stockHistory.from")}
                <DatePicker value={draft.from} min={overview.data?.data.available?.from} max={draft.to || overview.data?.data.available?.to} onChange={(value) => setDraft({ ...draft, from: value ?? "" })} className="w-full sm:w-40 [&_button]:h-8 [&_button]:text-xs" />
              </label>
              <label className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">{t("stockHistory.to")}
                <DatePicker value={draft.to} min={draft.from || overview.data?.data.available?.from} max={overview.data?.data.available?.to} onChange={(value) => setDraft({ ...draft, to: value ?? "" })} className="w-full sm:w-40 [&_button]:h-8 [&_button]:text-xs" />
              </label>
              <Button type="submit" variant="outline" size="sm">{t("stockHistory.apply")}</Button>
              {ranged && <Button type="button" variant="ghost" size="sm" onClick={() => { setDraft({ from: "", to: "" }); void setFrom(null); void setTo(null); }}>{t("stockHistory.reset")}</Button>}
            </form>
          } />
        <DataState query={history}>
          {(envelope) => (
            <div className="flex flex-col gap-1">
              <DataTable mobile="cards" testId="history-table" columns={historyColumns} data={[...envelope.data.rows].reverse()} meta={freshnessMeta(envelope)} caption={t("stockHistory.title")} getRowId={(row) => row.date} maxHeight={420} />
              {ranged && envelope.data.rows.length >= ARJUM_LIMITS.historyRows && <p className="text-[11px] text-muted-foreground">{t("stockHistory.rangeCapped", { count: ARJUM_LIMITS.historyRows })}</p>}
            </div>
          )}
        </DataState>
      </section>
      <DataState query={seasonality} compact>{(envelope) => <SeasonalityHeatmap data={envelope.data} meta={freshnessMeta(envelope)} />}</DataState>
      <DataState query={tape} compact>
        {(envelope) => {
          const data = envelope.data;
          return (
            <section className="flex flex-col gap-2">
              <SectionHeader title={t("stockHistory.tape", { date: formatDate(data.date, locale) })} description={t("stockHistory.tapeNote", { total: formatValue(data.total, "number", locale) })}
                actions={
                  <Select value={tapeDate ?? LATEST} onValueChange={(value) => { void setTapeDate(value === LATEST ? null : value); void setTapePage(null); }}>
                    <SelectTrigger className="h-8 w-40 text-xs" aria-label={t("stockHistory.tapeDate")} data-testid="tape-date"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={LATEST}>{t("stockHistory.latestSession")}</SelectItem>
                      {sessions.map((date) => <SelectItem key={date} value={date}>{formatDate(date, locale)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                } />
                            <DataTable mobile="cards" renderCard={(row) => (
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="num font-medium">{row.time}</span>
                    <span className="ticker">{formatIdr(row.priceIdr, locale)} <span className="text-muted-foreground">· {formatValue(row.lots, "number", locale)} lot</span></span>
                  </div>
                  <dl className="grid grid-cols-3 gap-x-3 gap-y-1">
                    <div><dt className="caption-style text-subtle">{t("metrics.value")}</dt><dd className="ticker text-data">{formatIdr(row.valueIdr, locale, { compact: true })}</dd></div>
                    <div><dt className="caption-style text-subtle">{t("stockHistory.buyer")}</dt><dd className="ticker text-data">{row.buyer}<span className="ml-1 text-muted-foreground">{row.buyerType}</span></dd></div>
                    <div><dt className="caption-style text-subtle">{t("stockHistory.seller")}</dt><dd className="ticker text-data">{row.seller}<span className="ml-1 text-muted-foreground">{row.sellerType}</span></dd></div>
                    <div><dt className="caption-style text-subtle">{t("stockHistory.board")}</dt><dd className="ticker text-data">{row.board}</dd></div>
                    <div><dt className="caption-style text-subtle">{t("stockHistory.aggressor")}</dt><dd className="ticker text-data">{row.aggressor}</dd></div>
                  </dl>
                </div>
              )} testId="tape-table" columns={tapeColumns} data={data.rows} meta={freshnessMeta(envelope)} caption={t("stockHistory.tape", { date: data.date })} maxHeight={360} />
              <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span className="num" data-testid="tape-page">{t("stockHistory.page", { page: data.page, total: Math.max(1, data.totalPages) })}</span>
                <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => void setTapePage(data.page - 1 > 1 ? data.page - 1 : null)}>{t("stockInsiders.previous")}</Button>
                <Button variant="outline" size="sm" disabled={data.page >= data.totalPages} onClick={() => void setTapePage(data.page + 1)} data-testid="tape-next">{t("stockInsiders.next")}</Button>
              </div>
            </section>
          );
        }}
      </DataState>
    </div>
  );
}
