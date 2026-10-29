"use client";

import { useLocale, useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { StatusBadge } from "@/components/feedback/status-badge";
import { SectionHeader } from "@/components/layout/section-header";
import { useDividendPatterns } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatPercent, type Locale } from "@/lib/format";
import type { DividendPatterns } from "@/server/schemas/dividend-patterns";

export function DividendsView({ symbol }: { symbol: string }) {
  const t = useTranslations("dividends");
  const query = useDividendPatterns(symbol);
  return <div className="flex flex-col gap-section p-4 md:p-6" data-testid="dividends-view">
    <SectionHeader title={t("title")} description={t("intro")} meta={query.data ? freshnessMeta(query.data) : undefined} />
    <DataState query={query}>{(envelope) => <DividendBody data={envelope.data} />}</DataState>
    <ResearchDisclaimer />
  </div>;
}

function DividendBody({ data }: { data: DividendPatterns }) {
  const t = useTranslations("dividends");
  const locale = useLocale() as Locale;
  const pct = (value: number | null) => value === null ? "—" : formatPercent(value, locale, { decimals: 1 });
  const yieldPct = (value: number | null) => pct(value === null ? null : value * 100);
  const recovery = (value: number | null, observed?: number) => value === null ? t(observed !== undefined && observed < 15 ? "pendingRecovery" : "notRecovered") : t("sessions", { count: value });
  const flags = (["lowTrapRisk", "capture", "runUp", "highYield"] as const).filter((key) => data.patterns[key]);
  return <div className="flex flex-col gap-section">
    <div className="rounded-xl border border-border bg-secondary/40 p-4 text-sm">
      <p className="font-medium" data-testid="dividend-asof">{t("asOf", { date: formatDate(data.asOf, locale) })}</p>
      <p className="mt-1 text-muted-foreground">{t("coverage", { from: formatDate(data.priceHistoryFrom, locale), count: data.history.length })}</p>
      <p className="mt-1 text-muted-foreground">{t("sourceNote")}</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <Metric label={t("trailingYield")} value={yieldPct(data.yield.trailing)} />
      <Metric label={t("aheadYield")} value={yieldPct(data.yield.ahead)} />
      <Metric label={t("selectedYield")} value={yieldPct(data.yield.selected)} />
    </div>
    <section className="space-y-3">
      <SectionHeader title={t("patterns")} description={t("patternRule", { value: formatIdr(1_000_000_000, locale) })} />
      <p className="caption-style text-subtle">{t("liquidity", { value: data.averageValue20 === null ? "—" : formatIdr(data.averageValue20, locale, { compact: true }) })}</p>
      {flags.length ? <div className="flex flex-wrap gap-2">{flags.map((key) => <StatusBadge key={key} tone="info">{t(`flags.${key}`)}</StatusBadge>)}</div> :
        <p className="text-sm text-muted-foreground">{t(data.history.length < 2 || !data.liquidityEligible ? "insufficient" : "noPattern")}</p>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Metric label={t("runUp")} value={pct(data.medians.runUpPercent)} />
        <Metric label={t("exDrop")} value={pct(data.medians.exDropPercentOfDividend)} />
        <Metric label={t("recovery")} value={data.medians.recoverySessions === null ? "—" : recovery(data.medians.recoverySessions)} />
        <Metric label={t("heldThrough")} value={pct(data.medians.heldThroughExPercent)} />
      </div>
    </section>
    <section className="space-y-3">
      <SectionHeader title={t("projected")} description={t("projectionRule")} />
      {data.projections.length ? <ul className="divide-y divide-border rounded-xl border border-border">{data.projections.map((row) => <li key={`${row.basedOnExDate}-${row.exDate}`} className="flex flex-wrap items-center gap-3 p-3 text-sm">
        <StatusBadge tone="warning">EST</StatusBadge><span className="num">{formatDate(row.exDate, locale)}</span>
        <span className="num ml-auto">{formatIdr(row.amount, locale, { decimals: 2 })}</span>
        <span className="w-full caption-style text-subtle">{t("basedOn", { date: formatDate(row.basedOnExDate, locale) })}</span>
      </li>)}</ul> : <p className="text-sm text-muted-foreground">{t("noProjection")}</p>}
    </section>
    <section className="space-y-3">
      <SectionHeader title={t("history")} description={t("historyNote")} />
      {data.history.length ? <div className="overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[46rem] text-sm">
        <thead><tr className="border-b border-border text-left text-muted-foreground">
          <th className="p-3">{t("exDate")}</th><th className="p-3 text-right">{t("amount")}</th><th className="p-3 text-right">{t("runUp")}</th><th className="p-3 text-right">{t("exDrop")}</th><th className="p-3 text-right">{t("recovery")}</th><th className="p-3 text-right">{t("heldThrough")}</th>
        </tr></thead><tbody>{[...data.history].reverse().map((row) => <tr key={row.exDate} className="border-b border-border last:border-0">
          <td className="p-3 num">{formatDate(row.exDate, locale)}</td><td className="p-3 text-right num">{formatIdr(row.amount, locale, { decimals: 2 })}</td>
          <td className="p-3 text-right num">{pct(row.runUpPercent)}</td><td className="p-3 text-right num">{pct(row.exDropPercentOfDividend)}</td>
          <td className="p-3 text-right num">{recovery(row.recoverySessions, row.observedSessionsAfterEx)}</td><td className="p-3 text-right num">{pct(row.heldThroughExPercent)}</td>
        </tr>)}</tbody>
      </table></div> : <p className="text-sm text-muted-foreground">{t("noHistory")}</p>}
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-border p-4"><div className="caption-style text-muted-foreground">{label}</div><div className="num mt-1 text-lg font-semibold">{value}</div></div>;
}
