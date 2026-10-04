"use client";

import { X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import { Button } from "@/components/ui/button";
import type { QuoteItem } from "@/lib/api/market";
import { formatIdr, type Locale } from "@/lib/format";
import { StockRow } from "./stock-row";

/**
 * Stocks with their latest quote. Each row can come from a different date or fail on its own, so
 * rows that differ from the list's overall freshness carry their own badge or reason code.
 */
export function QuoteList({ symbols, quotes, onRemove, marketCaps }: {
  symbols: Array<{ key: string; symbol: string }>;
  quotes: QuoteItem[] | undefined;
  onRemove?: (key: string, symbol: string) => void;
  /** Market cap (IDR) by symbol, when the list shows it. */
  marketCaps?: Map<string, number>;
}) {
  const t = useTranslations("watchlist");
  const locale = useLocale() as Locale;
  const bySymbol = new Map(quotes?.map((quote) => [quote.symbol, quote]));
  return (
    <div className="flex flex-col" data-testid="quote-list">
      {symbols.map(({ key, symbol }) => {
        const quote = bySymbol.get(symbol);
        const ok = quote?.status === "ok" ? quote : null;
        return (
          <div key={key} className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <StockRow
                symbol={symbol}
                price={ok ? ok.close : undefined}
                changePercent={ok ? ok.changePercent : undefined}
                trailing={
                  <>
                    {marketCaps && <span className="ticker hidden w-20 shrink-0 text-right text-muted-foreground sm:inline" data-testid={`market-cap-${symbol}`}>{formatIdr(marketCaps.get(symbol) ?? null, locale, { compact: true })}</span>}
                    {ok ? <FreshnessBadge freshness={ok.freshness} asOf={ok.asOf} period={ok.period} source={ok.source} />
                      : quote?.status === "error" ? <span className="ticker text-[11px] text-muted-foreground" data-testid={`quote-error-${symbol}`}>{quote.error}</span>
                      : null}
                  </>
                }
              />
            </div>
            {onRemove && (
              <Button variant="ghost" size="icon" aria-label={t("remove", { symbol })} onClick={() => onRemove(key, symbol)} data-testid={`remove-${symbol}`}>
                <X />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
