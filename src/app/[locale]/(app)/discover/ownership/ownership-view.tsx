"use client";

import { useQueries } from "@tanstack/react-query";
import { Landmark } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { InsidersTable } from "@/components/data/insiders-table";
import { EmptyState } from "@/components/feedback/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import type { ViewerSummary } from "@/components/layout/types";
import { stockHref } from "@/components/layout/nav-config";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useRouter } from "@/i18n/navigation";
import { marketApi } from "@/lib/api/market";
import { leastFresh } from "@/lib/freshness";
import { queryKeys } from "@/lib/query/keys";
import { useWatchlist } from "@/lib/watchlist";

const TICKER = /^[A-Z0-9]{1,12}$/;

export function OwnershipView({ viewer }: { viewer: ViewerSummary }) {
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
      <EmptyState compact icon={<Landmark />} title={t("marketWideUnavailable")} />
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
