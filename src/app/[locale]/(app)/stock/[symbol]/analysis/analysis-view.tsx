"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, type ReactNode } from "react";
import { DataTable } from "@/components/data/data-table";
import { DataState } from "@/components/feedback/data-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Meter } from "@/components/kit/meter";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { useAnalysis } from "@/lib/api/hooks";
import type { AnalysisFactor, AnalysisPattern, StockAnalysis } from "@/lib/api/market";
import { macdDirection, patternMessage, position, rsiZone, toneStatus, volumeLevel } from "@/lib/analysis";
import { freshnessMeta, type FreshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatNumber, formatPercent, formatValue, formatVolume, type Locale } from "@/lib/format";

/**
 * The provider's technical and flow analysis for the latest session, in HAKAPRO's own words.
 * Every label here is ours; the provider text is reduced to numbers and categories server-side.
 */
export function AnalysisView({ symbol }: { symbol: string }) {
  const t = useTranslations("analysis");
  const query = useAnalysis(symbol);
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="analysis-view">
      <SectionHeader title={t("title")} description={t("intro")} meta={query.data ? freshnessMeta(query.data) : undefined} />
      <DataState query={query}>
        {(envelope) => <AnalysisBody data={envelope.data} meta={freshnessMeta(envelope)} />}
      </DataState>
      <ResearchDisclaimer />
    </div>
  );
}

function Facts({ items }: { items: Array<{ label: ReactNode; value: ReactNode; testId?: string }> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-data min-[420px]:grid-cols-2">
      {items.map((item, index) => (
        <div key={index} className="flex min-w-0 flex-col" data-testid={item.testId}>
          <dt className="truncate text-xs text-muted-foreground">{item.label}</dt>
          <dd className="ticker break-words">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AnalysisBody({ data, meta }: { data: StockAnalysis; meta: FreshnessMeta }) {
  const t = useTranslations("analysis");
  const locale = useLocale() as Locale;
  const idr = (value: number | null | undefined) => formatIdr(value, locale);
  const idrCompact = (value: number | null | undefined) => formatIdr(value, locale, { compact: true });
  const pct = (value: number | null | undefined, signed = false) => formatPercent(value, locale, { signed });
  const close = data.price.closeIdr;
  const sma20 = data.technical.sma.find((item) => item.period === 20)?.valueIdr ?? null;
  const zone = rsiZone(data.technical.rsi14);
  const macd = macdDirection(data.technical.macd?.histogram);
  const volume = volumeLevel(data.volume.ratio);
  const bands = data.technical.bollinger;

  const patternColumns = useMemo<ColumnDef<AnalysisPattern, unknown>[]>(() => [
    { id: "pattern", header: t("patterns.pattern"), cell: ({ row }) => <span className="block min-w-44"><PatternName pattern={row.original.pattern} /></span> },
    { accessorKey: "quality", header: t("patterns.quality"), cell: ({ getValue }) => <StatusBadge tone={getValue<string>() === "historicalEdge" ? "positive" : "neutral"}>{t(`patterns.qualities.${getValue<string>()}`)}</StatusBadge> },
    { accessorKey: "winRatePercent", header: t("patterns.winRate"), meta: { numeric: true }, cell: ({ getValue }) => formatPercent(getValue<number | null>(), locale, { decimals: 1, signed: false }) },
    { accessorKey: "averageReturnPercent", header: t("patterns.averageReturn"), meta: { numeric: true }, cell: ({ getValue }) => formatPercent(getValue<number | null>(), locale, { signed: true }) },
    { accessorKey: "day3ReturnPercent", header: t("patterns.day3"), meta: { numeric: true }, cell: ({ getValue }) => formatPercent(getValue<number | null>(), locale, { signed: true }) },
    { accessorKey: "potentialPercent", header: t("patterns.potential"), meta: { numeric: true }, cell: ({ getValue }) => formatPercent(getValue<number | null>(), locale, { signed: true, decimals: 0 }) },
    { accessorKey: "drawdownPercent", header: t("patterns.drawdown"), meta: { numeric: true }, cell: ({ getValue }) => formatPercent(getValue<number | null>(), locale, { signed: true, decimals: 0 }) },
    { id: "exits", header: t("patterns.exits"), meta: { numeric: true }, cell: ({ row }) => <span className="whitespace-nowrap">{[row.original.takeProfitPercent, row.original.cutLossPercent, row.original.timeoutPercent].map((value) => formatPercent(value, locale, { decimals: 0, signed: false })).join(" / ")}</span> },
    { accessorKey: "samples", header: t("patterns.samples"), meta: { numeric: true }, cell: ({ getValue }) => formatValue(getValue<number | null>(), "number", locale) },
    { accessorKey: "profitFactor", header: t("patterns.profitFactor"), meta: { numeric: true }, cell: ({ getValue }) => formatNumber(getValue<number | null>(), locale) },
    { accessorKey: "averageExitDays", header: t("patterns.exitDays"), meta: { numeric: true }, cell: ({ getValue }) => formatNumber(getValue<number | null>(), locale, { decimals: 1 }) },
  ], [t, locale]);

  return (
    <div className="flex flex-col gap-4">
      <p className="caption-style text-subtle">{t("session", { date: formatDate(data.date, locale) })}</p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel testId="analysis-score" title={t("score.title")} meta={meta}>
          {data.score ? (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline gap-2">
                <span className="ticker text-2xl font-semibold" data-testid="analysis-score-value">{data.score.value}</span>
                <span className="text-sm text-muted-foreground">{t("score.of", { max: data.score.max })}</span>
                <StatusBadge tone={toneStatus(data.score.tone)}>{t(`tone.${data.score.tone ?? "unknown"}`)}</StatusBadge>
              </div>
              <Meter value={(data.score.value / Math.max(1, data.score.max)) * 100} label={t("score.title")} />
              <p className="caption-style text-subtle">{t("score.note")}</p>
            </div>
          ) : <p className="text-sm text-muted-foreground">{t("missing")}</p>}
        </Panel>

        <Panel testId="analysis-factors" title={t("factors.title")} meta={meta}>
          {data.factors.length ? (
            <ul className="flex flex-col gap-2">
              {data.factors.map((factor, index) => (
                <li key={index} className="flex items-start gap-2 text-sm">
                  {/* A factor without a tone is a plain observation; no badge rather than "unclassified". */}
                  {factor.tone && <StatusBadge tone={toneStatus(factor.tone)} className="shrink-0">{t(`tone.${factor.tone}`)}</StatusBadge>}
                  <FactorText factor={factor} />
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{t("missing")}</p>}
        </Panel>

        <Panel testId="analysis-outlook" title={t("outlook.title")} meta={meta}>
          {data.outlook ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={data.outlook.stance === "accumulate" ? "positive" : data.outlook.stance === "avoid" || data.outlook.stance === "reduce" ? "negative" : "warning"} data-testid="analysis-stance">
                  {t(`outlook.stances.${data.outlook.stance}`)}
                </StatusBadge>
                {data.outlook.small && <StatusBadge>{t("outlook.small")}</StatusBadge>}
                {data.outlook.conditional && <StatusBadge>{t("outlook.conditional")}</StatusBadge>}
                {data.outlook.historicalEdge && <StatusBadge tone="info">{t("outlook.historicalEdge")}</StatusBadge>}
              </div>
              <Facts items={[
                { label: t("outlook.entry"), value: data.outlook.entry ? `${idr(data.outlook.entry.lowIdr)} – ${idr(data.outlook.entry.highIdr)}` : "—" },
                { label: t("outlook.stopLoss"), value: data.outlook.stopLoss ? `${idr(data.outlook.stopLoss.priceIdr)}${data.outlook.stopLoss.percent !== null ? ` (${pct(data.outlook.stopLoss.percent, true)})` : ""}` : "—" },
                ...data.outlook.targets.map((target, index) => ({
                  label: t("outlook.target", { n: index + 1 }),
                  value: `${idr(target.priceIdr)}${target.basis ? ` · ${t(`levels.${target.basis}`)}` : ""}`,
                })),
              ]} />
              <p className="caption-style text-subtle">{t("outlook.note")}</p>
            </div>
          ) : <p className="text-sm text-muted-foreground">{t("missing")}</p>}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel testId="analysis-price" title={t("price.title")} meta={meta}>
          <Facts items={[
            { label: t("price.close"), value: <>{idr(close)} <span className="text-muted-foreground">({pct(data.price.changePercent, true)})</span></> },
            { label: t("price.previous"), value: idr(data.price.previousCloseIdr) },
            { label: t("price.open"), value: idr(data.price.openIdr) },
            { label: t("price.highLow"), value: `${idr(data.price.highIdr)} / ${idr(data.price.lowIdr)}` },
            { label: t("price.range"), value: `${idr(data.price.rangeIdr)} (${pct(data.price.rangePercent)})` },
          ]} />
          <table className="w-full text-data" aria-label={t("price.pivots")}>
            <caption className="caption-style pb-1 text-left text-subtle">{t("price.pivots")}</caption>
            <tbody>
              <tr className="text-xs text-muted-foreground">{(["s2", "s1", "p", "r1", "r2"] as const).map((key) => <th key={key} className="px-1 py-1 text-right font-medium">{t(`levels.${key.toUpperCase()}`)}</th>)}</tr>
              <tr>{(["s2", "s1", "p", "r1", "r2"] as const).map((key) => <td key={key} className="ticker px-1 py-1 text-right">{idr(data.price.pivots[key])}</td>)}</tr>
            </tbody>
          </table>
        </Panel>

        <Panel testId="analysis-technical" title={t("technical.title")} meta={meta}>
          <Facts items={[
            ...data.technical.sma.map((sma) => ({ label: t("technical.sma", { period: sma.period }), value: <>{idr(sma.valueIdr)} <span className="text-muted-foreground">{position(close, sma.valueIdr) ? t(`technical.position.${position(close, sma.valueIdr)}`) : ""}</span></> })),
            { label: t("technical.rsi"), value: <>{formatNumber(data.technical.rsi14, locale, { decimals: 0 })} <span className="text-muted-foreground">{zone ? t(`technical.rsiZone.${zone}`) : ""}</span></> },
            { label: t("technical.macd"), value: data.technical.macd ? <>{formatNumber(data.technical.macd.histogram, locale)} <span className="text-muted-foreground">{macd ? t(`technical.macdDirection.${macd}`) : ""}</span></> : "—" },
            { label: t("technical.bollinger"), value: bands ? `${idr(bands.lowerIdr)} – ${idr(bands.upperIdr)}` : "—" },
            { label: t("technical.bollingerMiddle"), value: bands ? <>{idr(bands.middleIdr)} <span className="text-muted-foreground">{position(close, bands.middleIdr) ? t(`technical.position.${position(close, bands.middleIdr)}`) : ""}</span></> : "—" },
            { label: t("technical.atr"), value: `${idr(data.technical.atrIdr)} (${pct(data.technical.atrPercent)})` },
          ]} />
          <p className="caption-style text-subtle">{t("technical.note", { sma20: idr(sma20) })}</p>
        </Panel>

        <Panel testId="analysis-volume" title={t("volume.title")} meta={meta}>
          <Facts items={[
            { label: t("volume.shares"), value: formatVolume(data.volume.shares, locale, { compact: true }) },
            { label: t("volume.lots"), value: formatVolume(data.volume.lots === null ? null : data.volume.lots * 100, locale, { unit: "lots", compact: true }) },
            { label: t("volume.value"), value: idrCompact(data.volume.valueIdr) },
            { label: t("volume.frequency"), value: formatValue(data.volume.frequency, "compact", locale) },
            { label: t("volume.average20"), value: formatVolume(data.volume.average20Shares, locale, { compact: true }) },
            { label: t("volume.ratio"), value: <>{data.volume.ratio === null ? "—" : `${formatNumber(data.volume.ratio, locale, { decimals: 1 })}×`} <span className="text-muted-foreground">{volume ? t(`volume.levels.${volume}`) : ""}</span></> },
            ...(data.volume.trend ? [{ label: t("volume.trend"), value: t(`volume.trends.${data.volume.trend}`) }] : []),
          ]} />
        </Panel>

        <Panel testId="analysis-foreign" title={t("foreign.title")} meta={meta}>
          <Facts items={[
            { label: t("foreign.net"), value: <>{formatVolume(data.foreign.netShares, locale, { compact: true, signed: true })} <span className="text-muted-foreground">{data.foreign.side ? t(`foreign.sides.${data.foreign.side}`) : ""}</span></> },
            { label: t("foreign.share"), value: pct(data.foreign.percentOfVolume) },
            ...(data.foreign.recent ? [
              { label: t("foreign.recent", { sessions: data.foreign.recent.sessions }), value: t("foreign.recentValue", { buy: data.foreign.recent.buyDays, sell: data.foreign.recent.sellDays }) },
              { label: t("foreign.recentAverage", { sessions: data.foreign.recent.sessions }), value: formatVolume(data.foreign.recent.averageNetShares, locale, { compact: true, signed: true }) },
            ] : []),
          ]} />
        </Panel>
      </div>

      <Panel testId="analysis-brokers" title={t("brokers.title")} meta={meta} description={data.brokers.total !== null ? t("brokers.total", { count: data.brokers.total }) : undefined}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Facts items={[
            { label: t("brokers.topBuyers"), value: data.brokers.topBuyers.map((row) => `${row.code} ${idrCompact(row.netValueIdr)}`).join(", ") || "—" },
            { label: t("brokers.topSellers"), value: data.brokers.topSellers.map((row) => `${row.code} ${idrCompact(row.netValueIdr)}`).join(", ") || "—" },
            { label: t("brokers.heavyBuyers"), value: data.brokers.heavyBuyers.join(", ") || "—" },
            { label: t("brokers.heavySellers"), value: data.brokers.heavySellers.join(", ") || "—" },
          ]} />
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{t("brokers.consistency")}</span>
            <ul className="flex flex-wrap gap-1.5">
              {data.brokers.consistency.map((row) => (
                <li key={`${row.code}-${row.side}`}><StatusBadge tone={row.side === "buy" ? "positive" : "negative"}>{t(`brokers.consistent.${row.side}`, { code: row.code, days: row.days, sessions: row.sessions })}</StatusBadge></li>
              ))}
              {data.brokers.moreConsistent > 0 && <li className="text-xs text-muted-foreground">{t("brokers.more", { count: data.brokers.moreConsistent })}</li>}
            </ul>
          </div>
        </div>
      </Panel>

      <section className="flex flex-col gap-2">
        <SectionHeader title={t("patterns.title")} description={t("patterns.intro")} />
        <DataTable testId="analysis-patterns" columns={patternColumns} data={data.patterns} meta={meta} caption={t("patterns.title")} />
      </section>
    </div>
  );
}

function FactorText({ factor }: { factor: AnalysisFactor }) {
  const t = useTranslations("analysis.factors");
  switch (factor.key) {
    case "priceVsSma": return <span>{t(`priceVsSma.${factor.position}`, { period: factor.period })}</span>;
    case "volume": return <span>{t(`volume.${factor.level}`)}</span>;
    case "foreign": return <span>{t(`foreign.${factor.side}`)}</span>;
    case "brokers": return <span>{t(`brokers.${factor.side}`)}</span>;
    case "rsiZone": return <span>{t(`rsiZone.${factor.zone}`)}</span>;
    default: return <span className="text-muted-foreground">{t("other")}</span>;
  }
}

function PatternName({ pattern }: { pattern: AnalysisPattern["pattern"] }) {
  const t = useTranslations("analysis.pattern");
  const parts = useTranslations("analysis.patternParts");
  const message = patternMessage(pattern);
  if (pattern.key === "combination") return <span>{t("combination", { parts: pattern.parts.map((part) => parts(part)).join(" + ") })}</span>;
  return <span>{t(message.key, message.values)}</span>;
}
