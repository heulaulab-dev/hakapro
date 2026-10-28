"use client";

import { ExternalLink } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { DataState } from "@/components/feedback/data-state";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { ApiError } from "@/lib/api/envelope";
import { useCorporateActions, useOwnership, useProfile } from "@/lib/api/hooks";
import { freshnessMeta, sourceLabel } from "@/lib/freshness";
import { formatDate, formatNumber, type Locale } from "@/lib/format";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type NetworkSelection = { holderName: string; holderKind: string; shares: string | null; percent: string | null; localForeign: string | null; symbol: string; issuerName: string | null; snapshotDate: string | null };

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
  const [selectedHolder, setSelectedHolder] = useState<NetworkSelection | null>(null);
  // No current source has issuer profiles (IDX blocks the engine): leave the section out instead of an outage message.
  const profileUnsupported = profile.error instanceof ApiError && profile.error.code === "UNSUPPORTED";
  const selectProfileHolder = (record: Record<string, unknown>) => setSelectedHolder({
    holderName: field(record, "Nama", "name") ?? "—", holderKind: "disclosed holder", shares: null,
    percent: field(record, "Persentase", "percentage"), localForeign: null, symbol: symbol.toUpperCase(), issuerName: null, snapshotDate: null,
  });
  const people = (title: string, records: Array<Record<string, unknown>>, kind: "holder" | "person") => (
    <Panel title={title}>
      <ul className="p-style flex flex-col divide-y divide-border">
        {records.map((record, index) => (
          <li key={index} className="flex items-center justify-between gap-3 py-2">
            {kind === "holder" ? <button type="button" onClick={() => selectProfileHolder(record)} className="flex w-full items-center justify-between gap-3 text-left transition-colors hover:bg-(--overlay-soft)" data-testid={`profile-holder-${index}`}>
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{field(record, "Nama", "name") ?? "—"}</span>
              {kind === "holder" && field(record, "Kategori") && <span className="text-[11px] text-muted-foreground">{field(record, "Kategori")}</span>}
            </span>
            <span className="ticker shrink-0 text-xs text-muted-foreground">{kind === "holder" ? (field(record, "Persentase", "percentage") ?? "") : (field(record, "Jabatan", "position") ?? "")}</span>
            </button> : <><span className="flex min-w-0 flex-col"><span className="truncate">{field(record, "Nama", "name") ?? "—"}</span></span><span className="ticker shrink-0 text-xs text-muted-foreground">{field(record, "Jabatan", "position") ?? ""}</span></>}
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
                  {t("kseiAsOf", { date: formatDate(envelope.data.snapshotDate, locale), source: sourceLabel(envelope.data.source?.dataset ?? envelope.source) })}
                </p>
                <ul className="flex flex-col divide-y divide-border rounded-xl border border-border px-4 text-sm">
                  {envelope.data.holders.map((holder) => (
                    <li key={holder.holderKey}>
                      <button type="button" onClick={() => setSelectedHolder({ ...holder, symbol: envelope.data.symbol, issuerName: envelope.data.issuerName, snapshotDate: envelope.data.snapshotDate })} className="flex w-full items-center justify-between gap-3 py-2 text-left transition-colors hover:bg-(--overlay-soft)" data-testid={`ownership-holder-${holder.holderKey}`}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{holder.holderName}</span>
                        {holder.localForeign && <span className="text-[11px] text-muted-foreground">{holder.localForeign}</span>}
                      </span>
                      <span className="num shrink-0 text-xs text-muted-foreground">
                        {holder.shares !== null && `${formatNumber(Number(holder.shares), locale)} · `}{holder.percent === null ? "—" : `${Number(holder.percent).toFixed(2)}%`}
                      </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </DataState>
      <InvestorNetworkDialog holder={selectedHolder} onClose={() => setSelectedHolder(null)} />
      {!profileUnsupported && <DataState query={profile}>
        {(envelope) => (
          <div className="flex flex-col gap-4">
            <SectionHeader title={t("title")} description={t("profileNote")} meta={freshnessMeta(envelope)} />
            <p className="caption-style text-subtle" data-testid="profile-provenance">
              {t("retrieved", { date: formatDate(envelope.data.retrievedAt, locale), dataset: sourceLabel(envelope.data.dataset ?? envelope.source) })}
            </p>
            {envelope.data.description && <p className="text-sm text-muted-foreground">{envelope.data.description}</p>}
            {safeUrl(envelope.data.website) && <a href={safeUrl(envelope.data.website)!} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-link hover:underline">{t("website")}<ExternalLink className="size-3" /></a>}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
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

function InvestorNetworkDialog({ holder, onClose }: { holder: NetworkSelection | null; onClose: () => void }) {
  const t = useTranslations("stockOwnership");
  const locale = useLocale() as Locale;
  const open = holder !== null;
  if (!holder) return null;
  const percentage = holder.percent === null ? "—" : `${Number(holder.percent).toFixed(2)}%`;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-[900px] bg-[#202020] text-[#f4f4f4]" data-testid="investor-network-dialog">
        <DialogHeader className="border-[#3a3a3a] bg-[#202020]">
          <DialogTitle className="text-lg tracking-tight">{holder.holderName}</DialogTitle>
          <DialogDescription className="text-[#a6a6a6]">{holder.holderKind} · {t("networkHoldingsCount", { count: 1 })}</DialogDescription>
        </DialogHeader>
        <DialogBody className="bg-[#202020]">
          <section className="border-b border-[#3a3a3a] px-6 py-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">{t("networkHoldings")}</h3>
              <span className="caption-style text-[#a6a6a6]">{holder.snapshotDate ? t("networkUpdated", { date: formatDate(holder.snapshotDate, locale) }) : t("networkUndated")}</span>
            </div>
            <div className="overflow-hidden rounded-lg border border-[#3a3a3a]">
              <table className="w-full text-sm" data-testid="investor-network-holdings">
                <thead className="bg-[#2c2c2c] text-left text-xs text-[#c7c7c7]"><tr><th className="px-3 py-2">{t("networkCode")}</th><th className="px-3 py-2">{t("networkCompany")}</th><th className="px-3 py-2 text-right">{t("networkShares")}</th><th className="px-3 py-2 text-right">{t("networkPercentage")}</th></tr></thead>
                <tbody><tr className="border-t border-[#3a3a3a]"><td className="ticker px-3 py-2">{holder.symbol}</td><td className="px-3 py-2">{holder.issuerName ?? holder.symbol}</td><td className="num px-3 py-2 text-right">{holder.shares === null ? "—" : formatNumber(Number(holder.shares), locale)}</td><td className="num px-3 py-2 text-right font-semibold">{percentage}</td></tr></tbody>
              </table>
            </div>
          </section>
          <section className="px-6 py-5">
            <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">{t("networkGraph")}</h3><span className="caption-style text-[#a6a6a6]">{holder.snapshotDate ? t("networkUpdated", { date: formatDate(holder.snapshotDate, locale) }) : t("networkUndated")}</span></div>
            <div className="relative min-h-64 overflow-hidden rounded-lg border border-[#3a3a3a] bg-[#1b1b1b]" data-testid="investor-network-graph">
              <svg viewBox="0 0 720 280" className="h-64 w-full" role="img" aria-label={t("networkGraphAria")}>
                <line x1="200" y1="140" x2="520" y2="140" stroke="#777" strokeDasharray="4 5" />
                <circle cx="200" cy="140" r="28" fill="#ef4444" stroke="#ff6b6b" strokeWidth="2" />
                <circle cx="520" cy="140" r="28" fill="#bc3150" />
                <text x="200" y="190" fill="#c7c7c7" textAnchor="middle" fontSize="13">{holder.holderName.slice(0, 24)}{holder.holderName.length > 24 ? "…" : ""}</text>
                <text x="520" y="190" fill="#c7c7c7" textAnchor="middle" fontSize="13">{holder.symbol} {percentage}</text>
              </svg>
              <p className="absolute bottom-3 left-0 right-0 text-center text-[11px] text-[#9b9b9b]">{t("networkLimited")}</p>
            </div>
          </section>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
