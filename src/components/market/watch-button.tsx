"use client";

import { Bell, Bookmark, BookmarkCheck, FileSearch } from "@/components/kit/icons";
import { useTranslations } from "next-intl";
import type { ViewerSummary } from "@/components/layout/types";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { useWatchlist, useWatchlistMutations } from "@/lib/watchlist";

/** Add/remove the stock from the default watchlist; anonymous users are sent to sign in. */
export function WatchButton({ symbol, viewer }: { symbol: string; viewer: ViewerSummary }) {
  const t = useTranslations("watchlist");
  const userId = viewer.kind === "user" ? viewer.id : null;
  const watchlist = useWatchlist(userId);
  const { add, remove } = useWatchlistMutations(userId, t("defaultName"));
  if (viewer.kind === "anonymous") {
    return (
      <Button variant="outline" size="sm" asChild>
        <Link href={`/login?next=${encodeURIComponent(`/stock/${symbol}`)}`}><Bookmark />{t("watch")}</Link>
      </Button>
    );
  }
  if (viewer.kind !== "user") return null; // bypass/unconfigured: no user to own a watchlist
  const item = watchlist.data?.items.find((candidate) => candidate.symbol === symbol);
  const busy = watchlist.isPending || watchlist.isError || add.isPending || remove.isPending;
  return (
    <>
      <Button variant={item ? "secondary" : "outline"} size="sm" disabled={busy} aria-pressed={Boolean(item)} data-testid="watch-button"
        onClick={() => (item ? remove.mutate(item.id) : add.mutate(symbol))}>
        {item ? <BookmarkCheck /> : <Bookmark />}
        {item ? t("watching") : t("watch")}
      </Button>
      {watchlist.isError && <span role="alert" className="text-xs text-negative">{t("loadFailed")}</span>}
      {(add.isError || remove.isError) && <span role="alert" className="text-xs text-negative">{t("failed")}</span>}
    </>
  );
}

/** Shortcut to create an alert for this stock (prefills the ticker). */
export function AlertLink({ symbol }: { symbol: string }) {
  const t = useTranslations("alerts");
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href={`/alerts?symbol=${symbol}`} data-testid="alert-link" aria-label={t("setAlert")}><Bell /><span className="max-md:sr-only">{t("setAlert")}</span></Link>
    </Button>
  );
}

/** Opens the per-ticker Research Brief. */
export function ResearchLink({ symbol }: { symbol: string }) {
  const t = useTranslations("research");
  return (
    <Button variant="ghost" size="sm" asChild>
      <Link href={`/research/${symbol}`} data-testid="research-link" aria-label={t("linkLabel", { code: symbol })}><FileSearch /><span className="max-md:sr-only">{t("link")}</span></Link>
    </Button>
  );
}
