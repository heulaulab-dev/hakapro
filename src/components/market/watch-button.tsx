"use client";

import { Bookmark, BookmarkCheck } from "lucide-react";
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
  const busy = watchlist.isPending || add.isPending || remove.isPending;
  return (
    <Button variant={item ? "secondary" : "outline"} size="sm" disabled={busy} aria-pressed={Boolean(item)} data-testid="watch-button"
      onClick={() => (item ? remove.mutate(item.id) : add.mutate(symbol))}>
      {item ? <BookmarkCheck /> : <Bookmark />}
      {item ? t("watching") : t("watch")}
    </Button>
  );
}
