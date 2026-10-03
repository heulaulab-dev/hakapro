"use client";

import { AlertTriangle } from "lucide-react";
import { parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { DivergingColumnChart } from "@/components/charts/diverging-column-chart";
import { StatementTable } from "@/components/data/statement-table";
import { DataState } from "@/components/feedback/data-state";
import { SectionHeader } from "@/components/layout/section-header";
import { ChartCard } from "@/components/market/chart-card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useFinancials } from "@/lib/api/hooks";
import { REPORT_TYPES } from "@/lib/api/market";
import { pruneEmptyRows } from "@/lib/financials";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, type Locale } from "@/lib/format";

const PERIODS = ["quarterly", "annual"] as const;

export function FinancialsView({ symbol }: { symbol: string }) {
  const t = useTranslations("financials");
  const locale = useLocale() as Locale;
  const [report, setReport] = useQueryState("report", parseAsStringLiteral(REPORT_TYPES).withDefault("INCOME_STATEMENT"));
  const [period, setPeriod] = useQueryState("period", parseAsStringLiteral(PERIODS).withDefault("quarterly"));
  const [showEmpty, setShowEmpty] = useQueryState("empty", parseAsBoolean.withDefault(false));
  const [rowKey, setRowKey] = useQueryState("row", parseAsString);
  const query = useFinancials(symbol, report, period);

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
