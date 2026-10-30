"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { BreadthHistoryCharts } from "@/components/charts/lazy";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { Segmented } from "@/components/kit/segmented";
import { useBreadth, useBreadthHistory, useForeignFlowPulse } from "@/lib/api/hooks";
import { ApiError } from "@/lib/api/envelope";
import { formatDate, formatIdr, formatNumber, formatPercent, formatVolume, type Locale } from "@/lib/format";
import type { BreadthWindow } from "@/lib/api/market";

const WINDOWS: BreadthWindow[] = ["1M", "3M", "6M", "1Y"];

export function IntelligenceView() {
  const t = useTranslations("intelligence");
  const locale = useLocale() as Locale;
  const [window, setWindow] = useState<BreadthWindow>("3M");
  const query = useBreadth();
  const history = useBreadthHistory(window);
  const foreignFlow = useForeignFlowPulse();
  const meta = history.data ? { freshness: history.data.freshness, asOf: history.data.asOf, source: history.data.source } : undefined;
  const foreignFlowMeta = foreignFlow.data ? { freshness: foreignFlow.data.freshness, asOf: foreignFlow.data.asOf, source: foreignFlow.data.source } : undefined;

  return <div className="flex flex-col gap-section p-4 md:p-6" data-testid="intelligence-view">
    <SectionHeader as="h1" title={t("title")} description={t("intro")} />
    <DataState query={query}>{(envelope) => envelope.data.regime === "UNAVAILABLE"
      ? <EmptyState title={t("unavailable")} description={t("unavailableDescription")} />
      : <div className="grid gap-4 md:grid-cols-3">
        <Panel title={t("regime")}><p className="text-2xl font-semibold" data-testid="breadth-regime">{envelope.data.regime}</p><p className="caption-style text-subtle">{envelope.data.snapshotDate} · {envelope.freshness}</p></Panel>
        <Panel title={t("participation")}><p className="text-2xl font-semibold">{envelope.data.advancers} / {envelope.data.decliners}</p><p className="caption-style text-subtle">{t("advancersDecliners")}</p></Panel>
        <Panel title={t("coverage")}><p className="text-2xl font-semibold">{envelope.data.unchanged}</p><p className="caption-style text-subtle">{t("unchanged")}</p></Panel>
        <Panel title={t("sectors")} className="md:col-span-3"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{envelope.data.sectors.slice(0, 8).map((sector) => <div key={sector.sector} className="rounded-lg border border-border px-3 py-2"><div className="text-sm font-medium">{sector.sector}</div><div className="caption-style text-subtle">{sector.changePercent === null ? "—" : `${(sector.changePercent * 100).toFixed(2)}%`} · {sector.advancers} / {sector.decliners}</div></div>)}</div></Panel>
      </div>}
    </DataState>

    <Panel title={t("foreignFlow.title")} description={t("foreignFlow.intro")} meta={foreignFlowMeta} testId="foreign-flow-pulse-panel">
      {foreignFlow.isError && foreignFlow.error instanceof ApiError && foreignFlow.error.code === "NO_DATA"
        ? <EmptyState title={t("foreignFlow.unavailable")} description={t("foreignFlow.unavailableDescription")} />
        : <DataState query={foreignFlow} isEmpty={(envelope) => envelope.data.history.length === 0}>
        {(envelope) => {
          const pulse = envelope.data;
          const coveragePercent = pulse.coverage.ratio * 100;
          return <>
            <p className="caption-style text-subtle" data-testid="foreign-flow-pulse-session">
              {t("foreignFlow.latestSession", { date: formatDate(pulse.date, locale) })}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="foreign-flow-pulse-metrics">
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="caption-style text-subtle">{t("foreignFlow.netShares")}</div>
                <div className="text-xl font-semibold" data-testid="foreign-flow-pulse-net-shares">{formatVolume(pulse.totals.netShares, locale, { compact: true, signed: true })}</div>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="caption-style text-subtle">{t("foreignFlow.netValueEstimate")}</div>
                <div className="text-xl font-semibold" data-testid="foreign-flow-pulse-net-value">{formatIdr(pulse.totals.netValueIdrEstimate, locale, { compact: true })}</div>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="caption-style text-subtle">{t("foreignFlow.coverage")}</div>
                <div className="text-xl font-semibold" data-testid="foreign-flow-pulse-coverage">
                  {t("foreignFlow.observedOfPriced", { observed: formatNumber(pulse.coverage.observed, locale, { decimals: 0 }), priced: formatNumber(pulse.coverage.priced, locale, { decimals: 0 }) })}
                  <span className="ml-1 text-sm font-normal text-subtle">({formatPercent(coveragePercent, locale, { signed: false, decimals: 1 })})</span>
                </div>
              </div>
              <div className="rounded-lg border border-border px-3 py-2">
                <div className="caption-style text-subtle">{t("foreignFlow.netBuyersSellers")}</div>
                <div className="text-xl font-semibold" data-testid="foreign-flow-pulse-buyer-seller">
                  {formatNumber(pulse.totals.netBuyers, locale, { decimals: 0 })} / {formatNumber(pulse.totals.netSellers, locale, { decimals: 0 })}
                </div>
                <div className="caption-style text-subtle">{t("foreignFlow.unchanged", { count: formatNumber(pulse.totals.unchanged, locale, { decimals: 0 }) })}</div>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <section aria-labelledby="foreign-flow-pulse-sectors-title">
                <h4 id="foreign-flow-pulse-sectors-title" className="eyebrow-style mb-2 text-soft">{t("foreignFlow.sectors")}</h4>
                {pulse.sectors.length === 0
                  ? <p className="caption-style text-subtle">{t("foreignFlow.noSectorData")}</p>
                  : <ul className="divide-y divide-border" data-testid="foreign-flow-pulse-sectors">
                    {pulse.sectors.slice(0, 5).map((sector) => <li key={sector.sector} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2" data-testid={`foreign-flow-pulse-sector-${sector.sector}`}>
                      <span className="flex flex-col"><span className="text-sm font-medium">{sector.sector}</span><span className="caption-style text-subtle">{t("foreignFlow.sectorObservedCoverage", { observed: formatNumber(sector.observed, locale, { decimals: 0 }), priced: formatNumber(sector.priced, locale, { decimals: 0 }) })}</span></span>
                      <span className="num text-right text-sm">{sector.observed > 0 ? <>{formatVolume(sector.netShares, locale, { compact: true, signed: true })}<span className="ml-2 text-subtle">{formatIdr(sector.netValueIdrEstimate, locale, { compact: true })}</span></> : <span className="text-subtle">{t("foreignFlow.noObservedSectorFlow")}</span>}</span>
                    </li>)}
                  </ul>}
              </section>

              <section aria-labelledby="foreign-flow-pulse-history-title">
                <h4 id="foreign-flow-pulse-history-title" className="eyebrow-style mb-2 text-soft">{t("foreignFlow.history")}</h4>
                <ul className="divide-y divide-border" data-testid="foreign-flow-pulse-history">
                  {pulse.history.map((point) => <li key={point.date} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span>{formatDate(point.date, locale)}</span>
                    <span className="num text-subtle">{t("foreignFlow.historyCoverage", { observed: formatNumber(point.observed, locale, { decimals: 0 }), priced: formatNumber(point.priced, locale, { decimals: 0 }) })}</span>
                  </li>)}
                </ul>
              </section>
            </div>
            <p className="caption-style leading-relaxed text-subtle" data-testid="foreign-flow-pulse-methodology">{t("foreignFlow.methodology")}</p>
          </>;
        }}
      </DataState>}
    </Panel>

    <Panel
      title={t("historyTitle")}
      description={t("historyIntro")}
      meta={meta}
      testId="breadth-history-panel"
      actions={<div data-testid="breadth-history-window"><Segmented value={window} onChange={(value) => setWindow(value as BreadthWindow)} options={WINDOWS.map((value) => ({ value, label: t(`windows.${value}`) }))} /></div>}
    >
      <DataState query={history} isEmpty={(envelope) => envelope.data.series.length === 0}>
        {(envelope) => <>
          <BreadthHistoryCharts data={envelope.data} />
          <p className="caption-style leading-relaxed text-subtle" data-testid="breadth-methodology">{t("methodology")}</p>
        </>}
      </DataState>
    </Panel>
  </div>;
}
