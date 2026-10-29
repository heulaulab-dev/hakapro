"use client";

import { useMemo, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { ChangeValue } from "@/components/market/change-value";
import { MultiLineChart, type LineSeries } from "@/components/charts/multi-line-chart";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useComparisonHistories } from "@/lib/api/hooks";
import type { History } from "@/lib/api/market";
import { normalizeComparisonSeries, normalizeComparisonSymbols } from "@/lib/comparison";
import { formatDate, formatValue, type Locale } from "@/lib/format";

const RANGES = ["1M", "3M", "6M", "1Y"] as const;
type Range = (typeof RANGES)[number];
const MONTHS: Record<Range, number> = { "1M": 1, "3M": 3, "6M": 6, "1Y": 12 };
const DEFAULT_SYMBOLS = "BBCA,BBRI,BMRI";

function dateBounds(range: Range) {
  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - MONTHS[range]);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}

export function CompareView() {
  const t = useTranslations("comparison");
  const locale = useLocale() as Locale;
  const [symbolParam, setSymbolParam] = useQueryState("symbols", parseAsString.withDefault(DEFAULT_SYMBOLS));
  const [rangeParam, setRangeParam] = useQueryState("range", parseAsString.withDefault("6M"));
  const symbols = normalizeComparisonSymbols(symbolParam);
  const range: Range = (RANGES as readonly string[]).includes(rangeParam) ? rangeParam as Range : "6M";
  const [input, setInput] = useState("");
  const bounds = useMemo(() => dateBounds(range), [range]);
  const queries = useComparisonHistories(symbols, bounds);
  const histories = queries.map((query, index) => ({ symbol: symbols[index], query, envelope: query.data })).filter((item) => Boolean(item.envelope));
  const series = histories.map(({ symbol, envelope }) => {
    const normalized = normalizeComparisonSeries(envelope!.data.rows.map((row) => ({ date: row.date, close: row.close })));
    return { symbol, normalized, history: envelope!.data as History };
  });
  const allDates = series.flatMap((item) => item.normalized.points.map((point) => point.date));
  const asOf = allDates.length ? [...allDates].sort().at(-1) ?? null : null;

  const updateSymbols = (next: string[]) => void setSymbolParam(next.join(","));
  const add = () => {
    const next = normalizeComparisonSymbols(`${symbols.join(",")},${input}`);
    if (next.length > symbols.length) { updateSymbols(next); setInput(""); }
  };
  const remove = (symbol: string) => updateSymbols(symbols.filter((item) => item !== symbol));

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="comparison-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} />
      <Panel title={t("pickTitle")} description={t("pickHint")}>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t("pickTitle")}>
          {symbols.map((symbol) => <span key={symbol} className="inline-flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm"><span className="ticker">{symbol}</span><button type="button" onClick={() => remove(symbol)} className="text-muted-foreground hover:text-foreground" aria-label={t("remove", { symbol })}>×</button></span>)}
          <form className="flex min-w-56 flex-1 gap-2" onSubmit={(event) => { event.preventDefault(); add(); }}>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder={t("addPlaceholder")} aria-label={t("addPlaceholder")} className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/60" />
            <Button type="submit" size="sm" variant="outline" disabled={symbols.length >= 4 || !input.trim()}>{t("add")}</Button>
          </form>
        </div>
        <p className="caption-style text-subtle">{t("max", { count: 4 })}</p>
      </Panel>

      <Panel title={t("performanceTitle")} description={t("performanceHint", { range })} meta={asOf ? { freshness: "EOD", asOf, source: "HAKA PRO Engine" } : undefined} actions={<ToggleGroup type="single" size="sm" variant="outline" value={range} onValueChange={(value) => value && void setRangeParam(value)} aria-label={t("rangeLabel")}>{RANGES.map((value) => <ToggleGroupItem key={value} value={value} className="px-3 text-xs" data-testid={`comparison-range-${value}`}>{value}</ToggleGroupItem>)}</ToggleGroup>}>
        {queries.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : queries.some((query) => query.isPending) ? <div className="h-64 animate-pulse rounded-md bg-muted" aria-busy="true" /> : <ComparisonChart series={series.map((item) => ({ key: item.symbol, label: item.symbol, points: item.normalized.points }))} ariaLabel={t("performanceTitle")} />}
      </Panel>

      <Panel title={t("tableTitle")} description={t("tableHint")}>
        {queries.some((query) => query.isError) && <p role="status" className="mb-3 text-xs text-warning">{t("partial")}</p>}
        <ComparisonTable items={series} locale={locale} />
      </Panel>
    </div>
  );
}

function ComparisonChart({ series, ariaLabel }: { series: LineSeries[]; ariaLabel: string }) {
  return <MultiLineChart series={series} format="number" ariaLabel={ariaLabel} height={280} />;
}

function ComparisonTable({ items, locale }: { items: Array<{ symbol: string; normalized: ReturnType<typeof normalizeComparisonSeries>; history: History }>; locale: Locale }) {
  const t = useTranslations("comparison");
  return <div className="overflow-x-auto"><Table className="min-w-[42rem] text-xs" data-testid="comparison-table"><TableHeader><TableRow interactive={false}><TableHead>{t("stock")}</TableHead><TableHead numeric>{t("latest")}</TableHead><TableHead numeric>{t("periodReturn")}</TableHead><TableHead numeric>{t("dailyMove")}</TableHead><TableHead numeric>{t("foreignNet")}</TableHead><TableHead>{t("asOf")}</TableHead></TableRow></TableHeader><TableBody>{items.map(({ symbol, normalized, history }) => { const latest = history.rows.at(-1); return <TableRow key={symbol}><TableCell className="ticker">{symbol}</TableCell><TableCell numeric className="num">{latest ? formatValue(latest.close, "number", locale) : "—"}</TableCell><TableCell numeric>{normalized.returnPercent === null ? "—" : <ChangeValue percent={normalized.returnPercent} />}</TableCell><TableCell numeric>{latest ? <ChangeValue percent={latest.changePercent} /> : "—"}</TableCell><TableCell numeric className="num">{latest ? formatValue(latest.foreignNetShares, "compact", locale) : "—"}</TableCell><TableCell className="num text-muted-foreground">{latest ? formatDate(latest.date, locale) : "—"}</TableCell></TableRow>; })}</TableBody></Table></div>;
}
