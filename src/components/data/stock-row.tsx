import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { ChangeValue } from "@/components/market/change-value";
import { stockHref } from "@/components/layout/nav-config";
import { Link } from "@/i18n/navigation";
import { formatIdr, type Locale } from "@/lib/format";

/**
 * One stock in a list (movers, watchlist, search). Freshness is shown once by the containing
 * section (SectionHeader/DataTable), not per row, to keep lists calm.
 */
export function StockRow({ symbol, name, price, changePercent, trailing, rank }: {
  symbol: string;
  /** Position in a ranked list, shown before the ticker. */
  rank?: number;
  name?: string | null;
  price?: number | null;
  changePercent?: number | null;
  trailing?: ReactNode;
}) {
  const locale = useLocale() as Locale;
  return (
    <Link
      href={stockHref(symbol)}
      data-testid={`stock-row-${symbol}`}
      className="flex h-row items-center gap-3 rounded-md px-cell-x text-data transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
    >
      {rank !== undefined && <span className="num w-6 shrink-0 text-right text-xs text-muted-foreground">{rank}</span>}
      <span className="ticker w-14 shrink-0 font-medium">{symbol}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{name}</span>
      {price !== undefined && <span className="ticker shrink-0 text-right">{formatIdr(price, locale)}</span>}
      {changePercent !== undefined && <ChangeValue percent={changePercent} className="w-20 shrink-0 justify-end text-right" />}
      {trailing}
    </Link>
  );
}
