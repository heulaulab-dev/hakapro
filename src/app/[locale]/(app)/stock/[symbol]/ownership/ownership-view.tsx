"use client";

import { ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { SectionHeader } from "@/components/layout/section-header";
import { useCorporateActions, useProfile } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, type Locale } from "@/lib/format";

/** Reads only well-known IDX company-detail keys; anything else is ignored rather than guessed. TODO(verify) keys. */
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
  const actions = useCorporateActions(symbol);
  const people = (title: string, records: Array<Record<string, unknown>>, kind: "holder" | "person") => (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {records.map((record, index) => (
          <li key={index} className="flex items-center justify-between gap-3 py-2">
            <span className="truncate">{field(record, "Nama", "name") ?? "—"}</span>
            <span className="ticker shrink-0 text-xs text-muted-foreground">{kind === "holder" ? (field(record, "Persentase", "percentage") ?? "") : (field(record, "Jabatan", "position") ?? "")}</span>
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="stock-ownership-view">
      <DataState query={profile}>
        {(envelope) => (
          <div className="flex flex-col gap-4">
            <SectionHeader title={t("title")} description={t("profileNote")} meta={freshnessMeta(envelope)} />
            {envelope.data.description && <p className="text-sm text-muted-foreground">{envelope.data.description}</p>}
            {safeUrl(envelope.data.website) && <a href={safeUrl(envelope.data.website)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">{t("website")}<ExternalLink className="size-3" /></a>}
            <div className="grid gap-4 lg:grid-cols-3">
              {people(t("shareholders"), envelope.data.shareholders, "holder")}
              {people(t("directors"), envelope.data.directors, "person")}
              {people(t("commissioners"), envelope.data.commissioners, "person")}
            </div>
          </div>
        )}
      </DataState>
      <DataState query={actions} compact isEmpty={(envelope) => envelope.data.length === 0}>
        {(envelope) => (
          <section className="flex flex-col gap-2">
            <SectionHeader title={t("actions")} meta={freshnessMeta(envelope)} />
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card px-4 text-sm">
              {envelope.data.map((action, index) => (
                <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="num text-xs text-muted-foreground">{formatDate(action.date, locale)}</span>
                  <span className="font-medium">{action.type}</span>
                  <span className="text-muted-foreground">{action.description}</span>
                  {safeUrl(action.documentUrl) && <a href={safeUrl(action.documentUrl)!} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-primary hover:underline"><ExternalLink className="size-3" /></a>}
                </li>
              ))}
            </ul>
          </section>
        )}
      </DataState>
    </div>
  );
}
