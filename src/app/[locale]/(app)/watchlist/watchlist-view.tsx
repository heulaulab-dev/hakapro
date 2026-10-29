"use client";

import { Bookmark, LogIn } from "@/components/kit/icons";
import { useTranslations } from "next-intl";
import { useState, type FormEvent } from "react";
import { AnalysisCompare } from "@/components/analysis/analysis-compare";
import { QuoteList } from "@/components/data/quote-list";
import { EmptyState } from "@/components/feedback/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import type { ViewerSummary } from "@/components/layout/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { useMarketCap, useQuotes } from "@/lib/api/hooks";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";
import { freshnessMeta } from "@/lib/freshness";
import { useWatchlist, useWatchlistMutations } from "@/lib/watchlist";

const TICKER = /^[A-Z0-9]{1,12}$/;

export function WatchlistView({ viewer }: { viewer: ViewerSummary }) {
  const t = useTranslations("watchlist");
  const userId = viewer.kind === "user" ? viewer.id : null;
  const watchlist = useWatchlist(userId);
  const { add, remove } = useWatchlistMutations(userId, t("defaultName"));
  const items = watchlist.data?.items ?? [];
  const symbols = items.map((item) => item.symbol);
  const quotes = useQuotes(symbols);
  // One request for the whole list (the provider accepts up to 50 symbols).
  const capSymbols = [...new Set(symbols)].slice(0, ARJUM_LIMITS.marketCapCodes);
  const caps = useMarketCap({ symbols: capSymbols }, { enabled: capSymbols.length > 0 });
  const marketCaps = caps.data ? new Map(caps.data.data.rows.map((row) => [row.symbol, row.marketCapIdr])) : undefined;
  const [input, setInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  if (viewer.kind !== "user") {
    return (
      <div className="flex flex-col gap-section p-4 md:p-6">
        <SectionHeader as="h1" title={t("title")} description={t("intro")} />
        <EmptyState icon={<LogIn />} title={t("signIn")} action={viewer.kind === "anonymous" ? <Button asChild size="sm"><Link href="/login?next=%2Fwatchlist">{t("watch")}</Link></Button> : undefined} />
      </div>
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const symbol = input.trim().toUpperCase();
    if (!TICKER.test(symbol)) return setMessage(t("invalid"));
    if (items.some((item) => item.symbol === symbol)) return setMessage(t("duplicate", { symbol }));
    setMessage(null);
    add.mutate(symbol, { onSuccess: () => setInput(""), onError: () => setMessage(t("failed")) });
  }

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="watchlist">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} meta={quotes.data ? freshnessMeta(quotes.data) : undefined} />
      <form onSubmit={submit} className="flex max-w-sm items-start gap-2">
        <label className="sr-only" htmlFor="add-symbol">{t("addLabel")}</label>
        <div className="flex flex-1 flex-col gap-1">
          <Input id="add-symbol" value={input} onChange={(event) => setInput(event.target.value)} placeholder={t("addPlaceholder")} className="ticker uppercase" autoComplete="off" />
          {message && <p role="alert" className="text-xs text-negative">{message}</p>}
        </div>
        <Button type="submit" variant="primary" size="md" disabled={add.isPending}>{t("add")}</Button>
      </form>
      {watchlist.isError ? <p role="alert" className="text-xs text-negative">{t("loadFailed")}</p> : watchlist.isPending ? <p role="status" className="text-xs text-muted-foreground">{t("loading")}</p> : items.length === 0 ? (
        <EmptyState icon={<Bookmark />} title={t("empty")} />
      ) : (
        <div className="rounded-xl border border-border p-2">
          <QuoteList symbols={items.map((item) => ({ key: item.id, symbol: item.symbol }))} quotes={quotes.data?.data} marketCaps={marketCaps} onRemove={(key) => remove.mutate(key, { onError: () => setMessage(t("failed")) })} />
        </div>
      )}
      {items.length > 0 && <AnalysisCompare symbols={symbols} />}
    </div>
  );
}
