"use client";

import { useEffect, useRef, useState } from "react";
import { StockTabsNav } from "@/components/layout/stock-tabs-nav";
import type { ViewerSummary } from "@/components/layout/types";
import { useHistory, usePrice } from "@/lib/api/hooks";
import { mergeLastPrice } from "@/lib/last-price";
import { formatIdr, type Locale } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useLocale } from "next-intl";
import { ChangeValue } from "./change-value";
import { OVERVIEW_HISTORY, StockHeaderLive } from "./stock-header-live";

/**
 * The stock page's top block: the full header scrolls away, and a sticky bar keeps the tabs plus a
 * one-line quote (ticker, price, change) in view, so context is never lost deep in a long tab.
 * Both reuse the header's queries (same keys), so this costs no extra requests.
 */
export function StockChrome({ symbol, viewer }: { symbol: string; viewer: ViewerSummary }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const [headerVisible, setHeaderVisible] = useState(true);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    // The sentinel sits right under the header; once it scrolls out of the page the header is gone.
    const observer = new IntersectionObserver(([entry]) => setHeaderVisible(entry.isIntersecting), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div className="px-4 pt-3 md:px-6 md:pt-4">
        <StockHeaderLive symbol={symbol} viewer={viewer} />
      </div>
      <div ref={sentinel} aria-hidden className="h-3 shrink-0" />
      <div data-testid="stock-sticky" data-collapsed={!headerVisible} className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur-md supports-[backdrop-filter]:bg-background/85">
        <StockTabsNav symbol={symbol} />
        <CompactQuote symbol={symbol} shown={!headerVisible} />
      </div>
    </>
  );
}

function CompactQuote({ symbol, shown }: { symbol: string; shown: boolean }) {
  const locale = useLocale() as Locale;
  const history = useHistory(symbol, OVERVIEW_HISTORY);
  const price = usePrice(symbol);
  const rows = history.data?.data.rows;
  const merged = rows?.length ? mergeLastPrice(rows, price.data?.data) : null;
  return (
    <div
      aria-hidden={!shown}
      inert={!shown}
      data-testid="stock-compact-quote"
      className={cn(
        // Hangs below the tabs (absolute) so showing and hiding it never moves the page content.
        "absolute inset-x-0 top-full flex items-baseline gap-3 border-b border-border bg-background/95 px-4 py-1.5 backdrop-blur-md motion-safe:transition-[opacity,transform] motion-safe:duration-200 md:px-6",
        shown ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-1 opacity-0",
      )}
    >
      <span className="ticker text-sm font-semibold">{symbol}</span>
      {merged && (
        <>
          <span className="ticker text-sm">{formatIdr(merged.close, locale)}</span>
          <ChangeValue percent={merged.changePercent} absolute={merged.change ?? undefined} className="text-xs" />
        </>
      )}
    </div>
  );
}
