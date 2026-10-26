import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import type { FreshnessMeta } from "@/lib/freshness";
import { formatIdr, formatVolume, type Locale } from "@/lib/format";
import type { HeaderStats } from "@/lib/stock-header";
import { cn } from "@/lib/utils";
import { ChangeValue } from "./change-value";

/**
 * Ticker, company, last price with change and freshness, and (when known) the day's turnover,
 * volume, foreign net and range, so a phone shows the whole picture without scrolling. The price is
 * never shown without its freshness.
 */
export function StockHeader({ symbol, name, price, change, changePercent, meta, actions, note, stats }: {
  symbol: string;
  name?: string | null;
  price: number | null | undefined;
  change?: number | null;
  changePercent: number | null | undefined;
  meta: FreshnessMeta;
  actions?: ReactNode;
  /** Short context next to the price, e.g. the last trade time or that the market is closed. */
  note?: ReactNode;
  stats?: HeaderStats;
}) {
  const locale = useLocale() as Locale;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span data-testid="stock-header-symbol" className="ticker text-[20px] leading-tight font-semibold tracking-[-0.01em]">{symbol}</span>
          {name && <span className="caption-style truncate pt-1 text-soft">{name}</span>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="ticker text-[26px] leading-none font-semibold tracking-[-0.01em]">{formatIdr(price, locale)}</span>
        <ChangeValue percent={changePercent} absolute={change ?? undefined} className="text-sm" />
        <FreshnessBadge {...meta} />
        {note && <span className="text-xs text-muted-foreground">{note}</span>}
      </div>
      {stats && <HeaderStatStrip stats={stats} locale={locale} />}
    </div>
  );
}

/** Two columns on a phone, one row from `sm`. Missing figures are omitted rather than shown as zero. */
function HeaderStatStrip({ stats, locale }: { stats: HeaderStats; locale: Locale }) {
  const t = useTranslations("metrics");
  const items: Array<{ key: string; label: string; value: string; tone?: "positive" | "negative" }> = [];
  if (stats.valueIdr !== null) items.push({ key: "value", label: t("value"), value: formatIdr(stats.valueIdr, locale, { compact: true }) });
  if (stats.volumeShares !== null) items.push({ key: "volume", label: t("volume"), value: formatVolume(stats.volumeShares, locale, { unit: "lots", compact: true }) });
  if (stats.foreignNetShares !== null) items.push({ key: "foreign", label: t("foreignNet"), value: formatVolume(stats.foreignNetShares, locale, { unit: "lots", compact: true, signed: true }), tone: stats.foreignNetShares > 0 ? "positive" : stats.foreignNetShares < 0 ? "negative" : undefined });
  if (stats.low !== null && stats.high !== null) items.push({ key: "range", label: t("dayRange"), value: `${formatIdr(stats.low, locale)} – ${formatIdr(stats.high, locale)}` });
  if (!items.length) return null;
  return (
    <dl data-testid="stock-header-stats" className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border pt-2 sm:flex sm:flex-wrap sm:gap-x-6">
      {items.map((item) => (
        <div key={item.key} className="flex min-w-0 flex-col gap-0.5">
          <dt className="caption-style truncate text-subtle">{item.label}</dt>
          <dd className={cn("ticker text-[13px] leading-tight font-medium", item.tone === "positive" && "text-positive", item.tone === "negative" && "text-negative")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
