"use client";

import { ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { ApiError } from "@/lib/api/envelope";
import { useCorporateActions, useOwnership, useProfile } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatNumber, type Locale } from "@/lib/format";

/** Reads only the verified IDX company-detail keys (Nama, Jabatan, Persentase, Kategori); anything else is ignored. */
function field(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}
const safeUrl = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null);

export function StockOwnershipView({ symbol }: { symbol: string }) {
  const t = useTranslations("stockOwnership");
  const locale = useLocale() as Locale;
  const profile = useProfile(symbol);
  const ownership = useOwnership(symbol);
  const actions = useCorporateActions(symbol);
  // No current source has issuer profiles (IDX blocks the engine): leave the section out instead of an outage message.
  const profileUnsupported = profile.error instanceof ApiError && profile.error.code === "UNSUPPORTED";
  const people = (title: string, records: Array<Record<string, unknown>>, kind: "holder" | "person") => (
    <Panel title={title}>
      <ul className="p-style flex flex-col divide-y divide-border">
        {records.map((record, index) => (
          <li key={index} className="flex items-center justify-between gap-3 py-2">
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{field(record, "Nama", "name") ?? "—"}</span>
              {kind === "holder" && field(record, "Kategori") && <span className="text-[11px] text-muted-foreground">{field(record, "Kategori")}</span>}
            </span>
            <span className="ticker shrink-0 text-xs text-muted-foreground">{kind === "holder" ? (field(record, "Persentase", "percentage") ?? "") : (field(record, "Jabatan", "position") ?? "")}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="stock-ownership-view">
      <DataState query={ownership}>
        {(envelope) => (
          <section className="flex flex-col gap-3" data-testid="ksei-holders">
            <SectionHeader title={t("kseiTitle")} description={t("kseiNote")} meta={freshnessMeta(envelope)} />
            {envelope.data.holders.length === 0 ? <EmptyState compact title={t("kseiNone")} /> : (
              <>
                <p className="caption-style text-subtle">
                  {t("kseiAsOf", { date: formatDate(envelope.data.snapshotDate, locale), source: envelope.data.source?.dataset ?? envelope.source })}
                </p>
                <ul className="flex flex-col divide-y divide-border rounded-xl border border-border px-4 text-sm">
                  {envelope.data.holders.map((holder) => (
                    <li key={holder.holderKey} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{holder.holderName}</span>
                        {holder.localForeign && <span className="text-[11px] text-muted-foreground">{holder.localForeign}</span>}
                      </span>
                      <span className="num shrink-0 text-xs text-muted-foreground">
                        {holder.shares !== null && `${formatNumber(Number(holder.shares), locale)} · `}{holder.percent === null ? "—" : `${Number(holder.percent).toFixed(2)}%`}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </DataState>
      {!profileUnsupported && <DataState query={profile}>
        {(envelope) => (
          <div className="flex flex-col gap-4">
            <SectionHeader title={t("title")} description={t("profileNote")} meta={freshnessMeta(envelope)} />
            <p className="caption-style text-subtle" data-testid="profile-provenance">
              {t("retrieved", { date: formatDate(envelope.data.retrievedAt, locale), dataset: envelope.data.dataset ?? envelope.source })}
            </p>
            {envelope.data.description && <p className="text-sm text-muted-foreground">{envelope.data.description}</p>}
            {safeUrl(envelope.data.website) && <a href={safeUrl(envelope.data.website)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-link hover:underline">{t("website")}<ExternalLink className="size-3" /></a>}
            <div className="grid gap-4 lg:grid-cols-3">
              {people(t("shareholders"), envelope.data.shareholders, "holder")}
              {people(t("directors"), envelope.data.directors, "person")}
              {people(t("commissioners"), envelope.data.commissioners, "person")}
            </div>
          </div>
        )}
      </DataState>}
      <DataState query={actions} compact isEmpty={(envelope) => envelope.data.length === 0}>
        {(envelope) => (
          <section className="flex flex-col gap-2">
            <SectionHeader title={t("actions")} meta={freshnessMeta(envelope)} />
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border px-4 text-sm">
              {envelope.data.map((action, index) => (
                <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="num text-xs text-muted-foreground">{formatDate(action.date, locale)}</span>
                  <span className="font-medium">{action.type}</span>
                  <span className="text-muted-foreground">{action.description}</span>
                  {safeUrl(action.documentUrl) && <a href={safeUrl(action.documentUrl)!} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-link hover:underline"><ExternalLink className="size-3" /></a>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </DataState>
    </div>
  );
}
