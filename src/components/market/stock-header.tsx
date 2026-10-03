import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import type { FreshnessMeta } from "@/lib/freshness";
import { formatIdr, type Locale } from "@/lib/format";
import { ChangeValue } from "./change-value";

/** Ticker, company, last price with change and freshness. The price is never shown without its freshness. */
export function StockHeader({ symbol, name, price, change, changePercent, meta, actions }: {
  symbol: string;
  name?: string | null;
  price: number | null | undefined;
  change?: number | null;
  changePercent: number | null | undefined;
  meta: FreshnessMeta;
  actions?: ReactNode;
}) {
  const locale = useLocale() as Locale;
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <span data-testid="stock-header-symbol" className="ticker text-[20px] leading-tight font-semibold tracking-[-0.01em]">{symbol}</span>
          {name && <span className="caption-style truncate text-soft">{name}</span>}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="ticker text-[22px] leading-none font-semibold tracking-[-0.01em]">{formatIdr(price, locale)}</span>
          <ChangeValue percent={changePercent} absolute={change ?? undefined} className="text-sm" />
          <FreshnessBadge {...meta} />
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
