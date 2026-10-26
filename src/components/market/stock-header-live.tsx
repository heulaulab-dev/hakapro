"use client";

import { useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompanyName, useHistory, usePrice } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { mergeLastPrice } from "@/lib/last-price";
import { headerStats } from "@/lib/stock-header";
import type { ViewerSummary } from "@/components/layout/types";
import { StockHeader } from "./stock-header";
import { AlertLink, ResearchLink, WatchButton } from "./watch-button";

/** Shared history query: same key as the overview's chart and metrics, so it is fetched once. */
export const OVERVIEW_HISTORY = { frame: "daily", limit: 250 } as const;

/** Same silhouette as the loaded header (symbol, price, stat strip) so the page does not jump when data arrives. */
function HeaderSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export function StockHeaderLive({ symbol, viewer }: { symbol: string; viewer: ViewerSummary }) {
  const t = useTranslations("lastPrice");
  const history = useHistory(symbol, OVERVIEW_HISTORY);
  // Today's price (one request); when it fails the header falls back to the daily close.
  const price = usePrice(symbol);
  const name = useCompanyName(symbol);
  // When price data is unavailable the page body explains why; the header just names the stock.
  const watch = (
    <div className="flex items-center gap-1">
      <ResearchLink symbol={symbol} />
      <WatchButton symbol={symbol} viewer={viewer} />
      {viewer.kind === "user" && <AlertLink symbol={symbol} />}
    </div>
  );
  if (history.isError) {
    return (
      <div className="flex items-center justify-between gap-3">
        <span data-testid="stock-header-symbol" className="ticker text-xl font-semibold">{symbol}</span>
        {watch}
      </div>
    );
  }
  return (
    <DataState query={history} compact skeleton={<HeaderSkeleton />} isEmpty={(envelope) => envelope.data.rows.length === 0}>
      {(envelope) => {
        const today = price.data;
        const merged = mergeLastPrice(envelope.data.rows, today?.data)!;
        const fromPrice = merged.fromPrice && today !== undefined;
        const state = today?.data.marketState;
        const note = fromPrice && today.data.lastTradeTime
          ? t("lastTrade", { time: today.data.lastTradeTime.slice(0, 5) })
          : state && state !== "open" && state !== "unknown" ? t(`state.${state}`) : null;
        return (
          <StockHeader symbol={symbol} name={name.data} price={merged.close} change={merged.change} changePercent={merged.changePercent}
            meta={freshnessMeta(fromPrice ? today : envelope)} actions={watch}
            stats={headerStats(envelope.data.rows.at(-1), today?.data, fromPrice)}
            note={note ? <span data-testid="market-state">{note}</span> : undefined} />
        );
      }}
    </DataState>
  );
}
