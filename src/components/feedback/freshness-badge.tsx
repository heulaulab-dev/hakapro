"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { Freshness } from "@/lib/freshness";
import { formatDate, formatPeriod, type Locale } from "@/lib/format";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Color carries meaning: only LIVE is green, delays/staleness are amber, unknown is muted. */
const STYLES: Record<Freshness, { dot: string; text: string }> = {
  LIVE: { dot: "bg-status animate-pulse", text: "text-foreground" },
  DELAYED: { dot: "bg-warning", text: "text-foreground" },
  EOD: { dot: "bg-info", text: "text-foreground" },
  HISTORICAL: { dot: "bg-soft", text: "text-soft" },
  STALE: { dot: "border border-warning bg-transparent", text: "text-warning" },
  UNAVAILABLE: { dot: "border border-dashed border-subtle bg-transparent", text: "text-subtle" },
};

export type FreshnessBadgeProps = {
  freshness: Freshness;
  asOf: string | null;
  period?: string;
  source?: string;
  className?: string;
};

/** Plain-language freshness for any dataset; as-of, period and source on hover/focus. */
export function FreshnessBadge({ freshness, asOf, period, source, className }: FreshnessBadgeProps) {
  const t = useTranslations("freshness");
  const locale = useLocale() as Locale;
  const label = t(`states.${freshness}.label`);
  const style = STYLES[freshness];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="status"
          aria-label={t("ariaLabel", { state: label })}
          data-freshness={freshness}
          className={cn(
            "caption-style inline-flex h-[20px] shrink-0 items-center gap-1 rounded-full normal-case tracking-normal border border-(--tag-neutral-border) bg-muted py-[3px] pr-[6px] pl-[5px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
            style.text,
            className,
          )}
        >
          <span aria-hidden className={cn("size-1.5 rounded-full", style.dot)} />
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start">
        <div className="flex flex-col gap-0.5 py-0.5">
          <span className="font-medium">{label}</span>
          <span className="opacity-80">{t(`states.${freshness}.description`)}</span>
          <span className="num">{asOf ? t("asOf", { date: formatDate(asOf, locale) }) : t("noAsOf")}</span>
          {period && <span className="num">{t("period", { period: formatPeriod(period, locale) })}</span>}
          {source && <span className="opacity-80">{t("source", { source })}</span>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
