"use client";

import { useQueries } from "@tanstack/react-query";
import { Landmark } from "@/components/kit/icons";
import { useLocale, useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { InsiderFeedSection } from "@/components/data/insider-feed";
import { InsidersTable } from "@/components/data/insiders-table";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import type { ViewerSummary } from "@/components/layout/types";
import { stockHref } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link, useRouter } from "@/i18n/navigation";
import { useOwnershipChanges } from "@/lib/api/hooks";
import { marketApi } from "@/lib/api/market";
import { freshnessMeta, leastFresh } from "@/lib/freshness";
import { formatMonthName, type Locale } from "@/lib/format";
import { queryKeys } from "@/lib/query/keys";
import { useWatchlist } from "@/lib/watchlist";

const TICKER = /^[A-Z0-9]{1,12}$/;

export function OwnershipView({ viewer, canUpload = false }: { viewer: ViewerSummary; canUpload?: boolean }) {
  const t = useTranslations("ownershipChanges");
  const router = useRouter();
  const [symbol, setSymbol] = useState("");
  const watchlist = useWatchlist(viewer.kind === "user" ? viewer.id : null);
  const symbols = (watchlist.data?.items ?? []).slice(0, 10).map((item) => item.symbol);
  const insiders = useQueries({ queries: symbols.map((code) => ({ queryKey: queryKeys.insiders(code), queryFn: ({ signal }: { signal: AbortSignal }) => marketApi.insiders(code, signal) })) });
  const ok = insiders.flatMap((query, index) => (query.data ? [{ symbol: symbols[index], envelope: query.data }] : []));
  const rows = ok.flatMap(({ symbol: code, envelope }) => envelope.data.rows.map((row) => ({ ...row, symbol: code })));
  const asOf = ok.map(({ envelope }) => envelope.asOf).filter((value): value is string => value !== null).sort()[0] ?? null;

  function go(event: FormEvent) {
    event.preventDefault();
    const code = symbol.trim().toUpperCase();
    if (TICKER.test(code)) router.push(stockHref(code, "insiders"));
  }

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="ownership-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} />
      <KseiChanges canUpload={canUpload} />
      <InsiderFeedSection />
      <form onSubmit={go} className="flex max-w-sm items-center gap-2">
        <Input aria-label={t("checkStock")} placeholder={t("checkStock")} value={symbol} onChange={(event) => setSymbol(event.target.value)} className="ticker h-8 uppercase" data-testid="ownership-symbol" />
        <Button type="submit" size="sm">{t("go")}</Button>
      </form>
      <section className="flex flex-col gap-3">
        <SectionHeader title={t("watchlistTitle")} />
        {viewer.kind !== "user" ? <EmptyState compact title={t("watchlistSignIn")} />
          : symbols.length === 0 ? <EmptyState compact title={t("watchlistEmpty")} />
          : <InsidersTable rows={rows} showSymbol meta={{ freshness: ok.length ? leastFresh(ok.map(({ envelope }) => envelope.freshness)) : "UNAVAILABLE", asOf: ok.length ? asOf : null, source: ok[0]?.envelope.source ?? "none" }} />}
      </section>
    </div>
  );
}

/** Percent strings from the engine are exact decimals ("12.345678"); shown to two places, never recomputed. */
const pctText = (value: string | null) => (value === null ? "—" : `${Number(value).toFixed(2)}%`);
const ppText = (value: string | null) => (value === null ? "" : `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(2)} pp`);

/**
 * Market-wide changes among KSEI ≥1% holders for the newest month the owner uploaded. Unchanged holders are left out.
 * Before the first upload the engine answers with an empty, undated form: say exactly that.
 */
function KseiChanges({ canUpload }: { canUpload: boolean }) {
  const t = useTranslations("ownershipChanges");
  const locale = useLocale() as Locale;
  const query = useOwnershipChanges();
  const monthLabel = (month: string) => `${formatMonthName(Number(month.slice(5, 7)), locale)} ${month.slice(0, 4)}`;
  return (
    <section className="flex flex-col gap-3" data-testid="ksei-changes">
      <SectionHeader title={t("kseiTitle")} description={t("kseiHint")} meta={query.data ? freshnessMeta(query.data) : undefined}
        actions={canUpload ? <Link href="/admin/ownership" className="caption-style text-link hover:underline touch-target" data-testid="ksei-upload-link">{t("kseiUpload")}</Link> : undefined} />
      <DataState query={query} compact>
        {(envelope) => envelope.data.changes.length === 0 && envelope.data.comparisons.length === 0 ? <EmptyState compact icon={<Landmark />} title={t("kseiNone")} /> : (
          <div className="flex flex-col gap-2">
            <p className="caption-style text-subtle">{t("kseiMonths", { month: monthLabel(envelope.data.month), previous: monthLabel(envelope.data.previousMonth) })}</p>
            {envelope.data.changes.length === 0 && <p className="caption-style text-subtle" data-testid="ksei-no-comparison">{t("kseiSnapshotOnly", { count: envelope.data.comparisons.length })}</p>}
            {envelope.data.changes.length === 0 && envelope.data.comparisons.length > 0 ? (
              <ul className="flex flex-wrap gap-2" data-testid="ksei-snapshot-symbols">
                {envelope.data.comparisons.slice(0, 24).map((item) => <li key={item.symbol}><Link href={stockHref(item.symbol, "ownership")} className="ticker rounded border border-border px-2 py-1 text-link hover:bg-accent touch-target">{item.symbol}</Link></li>)}
              </ul>
            ) : (
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border px-4 text-sm">
              {envelope.data.changes.filter((change) => change.kind !== "UNCHANGED").map((change) => (
                <li key={`${change.symbol}-${change.holderKey}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <Link href={stockHref(change.symbol, "ownership")} className="ticker text-link hover:underline touch-target">{change.symbol}</Link>
                  <span className="min-w-0 flex-1 truncate">{change.holderName}</span>
                  <span className="caption-style text-subtle">{t(`kind.${change.kind}` as "kind.NEW")}</span>
                  <span className="num shrink-0 text-xs">{pctText(change.percentBefore)} → {pctText(change.percentAfter)} <span className="text-muted-foreground">{ppText(change.ppDelta)}</span></span>
                </li>
              ))}
            </ul>
            )}
            {envelope.data.changes.length > 0 && envelope.data.changes.every((change) => change.kind === "UNCHANGED") && <p className="caption-style text-subtle">{t("kseiNoChanges")}</p>}
          </div>
        )}
      </DataState>
    </section>
  );
}
