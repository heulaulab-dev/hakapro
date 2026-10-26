"use client";

import { Radar as RadarIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { StockRow } from "@/components/data/stock-row";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { StatusBadge } from "@/components/feedback/status-badge";
import { SectionHeader } from "@/components/layout/section-header";
import { CounterChip, SignalChip, useRadarText } from "@/components/radar/radar-chips";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link } from "@/i18n/navigation";
import { useRadar } from "@/lib/api/hooks";
import type { Radar, RadarStock } from "@/lib/api/market";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, type Locale } from "@/lib/format";
import { RADAR_SIGNAL_KEYS } from "@/lib/radar/rules";

const ALL_SECTORS = "all";
const MIN_OPTIONS = RADAR_SIGNAL_KEYS.map((_, index) => index + 1);

/** Signal confluence radar: documented observations per stock, counted, never scored. */
export function RadarView() {
  const t = useTranslations("radar");
  const query = useRadar();
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="radar-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} meta={query.data ? freshnessMeta(query.data) : undefined}
        actions={<Link href="/methodology" className="caption-style text-link hover:underline" data-testid="radar-methodology-link">{t("methodologyLink")}</Link>} />
      <DataState query={query}>{(envelope) => <RadarBody radar={envelope.data} />}</DataState>
      <ResearchDisclaimer />
    </div>
  );
}

function RadarBody({ radar }: { radar: Radar }) {
  const t = useTranslations("radar");
  const locale = useLocale() as Locale;
  const text = useRadarText();
  const [min, setMin] = useQueryState("min", parseAsInteger.withDefault(1));
  const [sector, setSector] = useQueryState("sector", parseAsString.withDefault(ALL_SECTORS));
  if (!radar.tradingDate) return <EmptyState icon={<RadarIcon />} title={t("noSession")} />;

  const sectors = [...new Set(radar.stocks.map((stock) => stock.sector).filter((value): value is string => value !== null))].sort();
  const shown = radar.stocks.filter((stock) => stock.firedCount >= min && (sector === ALL_SECTORS || stock.sector === sector));

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm" data-testid="radar-info">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="num font-medium" data-testid="radar-asof">{t("asOf", { date: formatDate(radar.tradingDate, locale) })}</span>
          <span className="caption-style ticker text-subtle" data-testid="radar-rules-version">{t("rulesVersion", { version: radar.rulesVersion })}</span>
          <span className="caption-style text-subtle" data-testid="radar-ksei-month">{radar.kseiMonth ? t("kseiMonth", { month: formatDate(radar.kseiMonth, locale) }) : t("kseiNotUploaded")}</span>
        </div>
        <p className="caption-style text-subtle" data-testid="radar-coverage">
          {t("coverage", { listed: radar.coverage.listed, stocks: radar.coverage.stocks })}
          {radar.coverage.returned < radar.coverage.listed && ` ${t("coverageCapped", { returned: radar.coverage.returned })}`}
        </p>
        <details className="caption-style text-subtle">
          <summary className="cursor-pointer">{t("coverageDetails")}</summary>
          <ul className="mt-1 grid gap-x-4 gap-y-0.5 sm:grid-cols-2" data-testid="radar-signal-coverage">
            {RADAR_SIGNAL_KEYS.map((key) => (
              <li key={key} className="flex justify-between gap-2">
                <span>{text.name(key, radar.rules)}</span>
                <span className="num">{t("coverageCount", { count: radar.coverage.signals[key], stocks: radar.coverage.stocks })}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>

      <div className="flex flex-wrap items-center gap-2" data-testid="radar-filters">
        <Select value={String(min)} onValueChange={(value) => void setMin(Number(value) === 1 ? null : Number(value))}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label={t("filters.minSignals")} data-testid="radar-min"><SelectValue /></SelectTrigger>
          <SelectContent>{MIN_OPTIONS.map((value) => <SelectItem key={value} value={String(value)}>{t("filters.minOption", { count: value })}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={sector} onValueChange={(value) => void setSector(value === ALL_SECTORS ? null : value)}>
          <SelectTrigger className="h-8 w-52 text-xs" aria-label={t("filters.sector")} data-testid="radar-sector"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SECTORS}>{t("filters.allSectors")}</SelectItem>
            {sectors.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="caption-style text-subtle">{t("shown", { count: shown.length })}</span>
      </div>

      {radar.stocks.length === 0 ? <EmptyState compact icon={<RadarIcon />} title={t("noneFired")} />
        : shown.length === 0 ? <EmptyState compact title={t("noMatch")} />
        : (
          <ol className="flex flex-col divide-y divide-border rounded-xl border border-border" data-testid="radar-list">
            {shown.map((stock, index) => <RadarItem key={stock.symbol} stock={stock} rank={index + 1} rules={radar.rules} />)}
          </ol>
        )}
    </section>
  );
}

function RadarItem({ stock, rank, rules }: { stock: RadarStock; rank: number; rules: Radar["rules"] }) {
  const t = useTranslations("radar");
  const text = useRadarText();
  const missing = RADAR_SIGNAL_KEYS.filter((key) => stock.status[key] === "missing");
  return (
    <li className="flex flex-col gap-2 px-2 py-2" data-testid={`radar-row-${stock.symbol}`}>
      <StockRow symbol={stock.symbol} rank={rank} name={stock.name} price={stock.close} changePercent={stock.changePercent}
        trailing={<StatusBadge tone="neutral" data-testid="radar-count">{t("firedCount", { count: stock.firedCount })}</StatusBadge>} />
      <div className="flex flex-wrap gap-1.5 px-cell-x" aria-label={t("firedLabel")}>
        {stock.fired.map((item) => <SignalChip key={item.key} item={item} rules={rules} />)}
      </div>
      {stock.counter.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-cell-x" aria-label={t("counterLabel")}>
          {stock.counter.map((item) => <CounterChip key={item.key} item={item} />)}
        </div>
      )}
      {missing.length > 0 && (
        <p className="caption-style px-cell-x text-subtle" data-testid="radar-missing">{t("missing", { list: missing.map((key) => text.name(key, rules)).join(", ") })}</p>
      )}
    </li>
  );
}
