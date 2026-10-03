import { useLocale } from "next-intl";
import type { ReactNode } from "react";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import type { FreshnessMeta } from "@/lib/freshness";
import { formatValue, type Locale, type ValueFormat } from "@/lib/format";
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
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5 rounded-xl border border-border px-cell-x py-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <FreshnessBadge {...meta} />
      </div>
      <span className="ticker truncate text-lg font-semibold">{formatValue(value, format, locale)}</span>
      {(changePercent !== undefined || hint) && (
        <div className="flex items-center gap-2 text-xs">
          {changePercent !== undefined && <ChangeValue percent={changePercent} />}
          {hint && <span className="truncate text-subtle">{hint}</span>}
        </div>
      )}
    </div>
  );
}
