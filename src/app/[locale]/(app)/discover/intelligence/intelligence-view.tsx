"use client";

import { useTranslations } from "next-intl";
import { SectionHeader } from "@/components/layout/section-header";
import { Panel } from "@/components/layout/panel";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { useBreadth } from "@/lib/api/hooks";

export function IntelligenceView() {
  const t = useTranslations("intelligence");
  const query = useBreadth();
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
  </div>;
}
