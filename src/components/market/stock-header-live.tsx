"use client";

import { DataState } from "@/components/feedback/data-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useCompanyName, useHistory } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { StockHeader } from "./stock-header";

/** Shared history query: same key as the overview's chart and metrics, so it is fetched once. */
export const OVERVIEW_HISTORY = { frame: "daily", limit: 250 } as const;

export function StockHeaderLive({ symbol }: { symbol: string }) {
  const history = useHistory(symbol, OVERVIEW_HISTORY);
  const name = useCompanyName(symbol);
  // When price data is unavailable the page body explains why; the header just names the stock.
  if (history.isError) return <span data-testid="stock-header-symbol" className="ticker text-xl font-semibold">{symbol}</span>;
  return (
    <DataState query={history} compact skeleton={<Skeleton className="h-16 w-72" />} isEmpty={(envelope) => envelope.data.rows.length === 0}>
      {(envelope) => {
        const latest = envelope.data.rows.at(-1)!;
        return <StockHeader symbol={symbol} name={name.data} price={latest.close} change={latest.change} changePercent={latest.changePercent} meta={freshnessMeta(envelope)} />;
      }}
    </DataState>
  );
}
