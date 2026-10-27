"use client";

import { useLocale } from "next-intl";
import { stockHref } from "@/components/layout/nav-config";
import { ChangeValue } from "@/components/market/change-value";
import { Link } from "@/i18n/navigation";
import { useMarketOverview } from "@/lib/api/hooks";
import { formatIdr, type Locale } from "@/lib/format";

/**
 * A thin scrolling strip of the day's top gainers across the top of the shell (BDMFlow-style ticker). Reads the market
 * overview (same cached query the dashboard uses); renders nothing until there are enough gainers to be worth showing.
 */
export function MarketTicker() {
  const locale = useLocale() as Locale;
  const query = useMarketOverview();
  const gainers = (query.data?.data.movers ?? [])
    .filter((row) => row.symbol && (row.changePercent ?? 0) > 0)
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0))
    .slice(0, 20);
  if (gainers.length < 4) return null;
  // Duplicated once so the marquee can loop seamlessly with a -50% translate.
  const loop = [...gainers, ...gainers];

  return (
    <div data-testid="market-ticker" className="relative h-8 shrink-0 overflow-hidden border-b border-border bg-sidebar">
      <div className="absolute inset-y-0 flex items-center gap-6 whitespace-nowrap pl-4 will-change-transform hover:[animation-play-state:paused]" style={{ animation: "hakapro-ticker 80s linear infinite" }}>
        {loop.map((row, index) => (
          <Link key={`${row.symbol}-${index}`} href={stockHref(row.symbol!)} className="flex items-center gap-1.5 outline-none">
            <span className="ticker text-xs font-semibold">{row.symbol}</span>
            <span className="num text-xs text-muted-foreground">{formatIdr(row.close, locale)}</span>
            <ChangeValue percent={row.changePercent} className="text-xs" />
          </Link>
        ))}
      </div>
      <style>{"@keyframes hakapro-ticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}@media (prefers-reduced-motion:reduce){[data-testid=market-ticker]>div{animation:none!important}}"}</style>
    </div>
  );
}
