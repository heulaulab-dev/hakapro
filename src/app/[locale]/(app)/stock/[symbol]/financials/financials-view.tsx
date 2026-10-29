"use client";

import { AlertTriangle } from "@/components/kit/icons";
import { parseAsBoolean, parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { DivergingColumnChart } from "@/components/charts/lazy";
import { StatementTable } from "@/components/data/statement-table";
import { DataState } from "@/components/feedback/data-state";
import { SectionHeader } from "@/components/layout/section-header";
import { ChartCard } from "@/components/market/chart-card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFinancials } from "@/lib/api/hooks";
import { REPORT_TYPES } from "@/lib/api/market";
import { pruneEmptyRows } from "@/lib/financials";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, type Locale } from "@/lib/format";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";

const PERIODS = ["quarterly", "annual"] as const;
const PERIOD_COUNTS = [12, 20, ARJUM_LIMITS.financialPeriods] as const;
/** Years offered by the year filter: the current year back to 2015 (the provider's statements start around then). */
const YEARS = Array.from({ length: new Date().getFullYear() - 2014 }, (_, index) => String(new Date().getFullYear() - index));
const ALL_YEARS = "all";

export function FinancialsView({ symbol }: { symbol: string }) {
  const t = useTranslations("financials");
  const locale = useLocale() as Locale;
  const [report, setReport] = useQueryState("report", parseAsStringLiteral(REPORT_TYPES).withDefault("INCOME_STATEMENT"));
  const [period, setPeriod] = useQueryState("period", parseAsStringLiteral(PERIODS).withDefault("quarterly"));
  const [showEmpty, setShowEmpty] = useQueryState("empty", parseAsBoolean.withDefault(false));
  const [rowKey, setRowKey] = useQueryState("row", parseAsString);
  const [year, setYear] = useQueryState("year", parseAsString);
  const [count, setCount] = useQueryState("periods", parseAsInteger.withDefault(12));
  const limit = (PERIOD_COUNTS as readonly number[]).includes(count) ? count : 12;
  const query = useFinancials(symbol, { reportType: report, period, limit, year });

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="financials-view">
      <SectionHeader title={t("title")} description={t("labelsNote")} />
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup type="single" size="sm" variant="outline" value={report} onValueChange={(value) => value && void setReport(value as typeof report)} aria-label={t("reportLabel")}>
          {REPORT_TYPES.map((type) => <ToggleGroupItem key={type} value={type} className="px-2.5 text-xs" data-testid={`report-${type}`}>{t(`report.${type}`)}</ToggleGroupItem>)}
        </ToggleGroup>
        <ToggleGroup type="single" size="sm" variant="outline" value={period} onValueChange={(value) => value && void setPeriod(value as typeof period)} aria-label={t("periodLabel")}>
          {PERIODS.map((value) => <ToggleGroupItem key={value} value={value} className="px-2.5 text-xs" data-testid={`period-${value}`}>{t(`period.${value}`)}</ToggleGroupItem>)}
        </ToggleGroup>
        <Select value={year ?? ALL_YEARS} onValueChange={(value) => void setYear(value === ALL_YEARS ? null : value)}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label={t("yearLabel")} data-testid="financials-year"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_YEARS}>{t("allYears")}</SelectItem>
            {YEARS.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
          </SelectContent>
        </Select>
        {!year && (
          <Select value={String(limit)} onValueChange={(value) => void setCount(Number(value) === 12 ? null : Number(value))}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label={t("periodsLabel")} data-testid="financials-periods"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIOD_COUNTS.map((value) => <SelectItem key={value} value={String(value)}>{t("periodsCount", { count: value })}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <Button variant="ghost" size="sm" onClick={() => void setShowEmpty(showEmpty ? null : true)} data-testid="toggle-empty">{showEmpty ? t("hideEmpty") : t("showEmpty")}</Button>
      </div>
      <DataState query={query} isEmpty={(envelope) => envelope.data.rows.length === 0}>
        {(envelope) => {
          const meta = freshnessMeta(envelope);
          const data = envelope.data;
          const rows = showEmpty ? data.rows : pruneEmptyRows(data.rows);
          const periods = data.periods.map((item) => item.label);
          const selected = rows.find((row) => row.key === rowKey && !row.expandable) ?? null;
          const lag = data.reportingLag;
          return (
            <>
              {lag.behind && (
                <p role="status" data-testid="lag-banner" className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-muted px-3 py-2 text-xs text-warning">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {t("lag", { latest: periods[0] ?? "—", expected: formatDate(lag.expectedPeriodEnd, locale) })}
                </p>
              )}
              <StatementTable rows={rows} periods={periods} meta={meta} caption={t(`report.${report}`)} selectedKey={selected?.key} onSelect={(row) => void setRowKey(row.key)} />
              <ChartCard testId="statement-chart" title={selected ? t("rowChart", { label: selected.label }) : t("pickRow")} meta={meta}
                footer={t("note", { fetched: formatDate(data.periods[0]?.fetchedAt ?? null, locale) })}>
                {selected ? (
                  <DivergingColumnChart
                    data={data.periods.map((item, index) => ({ date: item.label, value: selected.values[index] ?? 0, missing: selected.values[index] === null })).filter((item) => !item.missing).reverse()}
                    format="idrCompact" ariaLabel={selected.label} formatX={(label) => label} positiveLabel={selected.label} negativeLabel={selected.label} />
                ) : <p className="text-sm text-muted-foreground">{t("pickRow")}</p>}
              </ChartCard>
            </>
          );
        }}
      </DataState>
    </div>
  );
}
