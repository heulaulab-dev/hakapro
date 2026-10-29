import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import type { FreshnessMeta } from "@/lib/freshness";
import { direction, formatValue, type Locale, type ValueFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChangeValue } from "./change-value";

/** Compact stat tile: label, value (formatted by declared unit), optional signed change, freshness. */
export function MetricCard({ label, value, format, changePercent, hint, meta, className }: {
  label: ReactNode;
  value: number | null | undefined;
  format: ValueFormat;
  changePercent?: number | null;
  hint?: ReactNode;
  meta: FreshnessMeta;
  className?: string;
}) {
  const locale = useLocale() as Locale;
  const trend = changePercent === undefined ? "neutral" : direction(changePercent);
  return (
    <div
      data-trend={trend}
      className={cn(
        "surface-card relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-xl border border-border px-cell-x py-3",
        // Top edge in the market color of the change it shows; neutral cards keep no accent.
        "before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:content-[''] data-[trend=positive]:before:bg-linear-to-r data-[trend=positive]:before:from-transparent data-[trend=positive]:before:via-positive/70 data-[trend=positive]:before:to-transparent data-[trend=negative]:before:bg-linear-to-r data-[trend=negative]:before:from-transparent data-[trend=negative]:before:via-negative/70 data-[trend=negative]:before:to-transparent",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <FreshnessBadge {...meta} compact />
      </div>
      <span className="ticker text-base leading-tight font-semibold tracking-tight break-words sm:text-xl">{formatValue(value, format, locale)}</span>
      {(changePercent !== undefined || hint) && (
        <div className="flex items-center gap-2 text-xs">
          {changePercent !== undefined && <ChangeValue percent={changePercent} />}
          {hint && <span className="truncate text-subtle">{hint}</span>}
        </div>
      )}
    </div>
  );
}
