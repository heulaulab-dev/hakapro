"use client";

import { useLocale, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { Freshness } from "@/lib/freshness";
import { formatDate, formatPeriod, type Locale } from "@/lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MEDIA, useMediaQuery } from "@/lib/use-media-query";

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
  /** Phones: show only the status dot (the label stays available to screen readers and in the tap/hover details). */
  compact?: boolean;
};

/** Plain-language freshness for any dataset; as-of, period and source on hover/focus. */
export function FreshnessBadge({ freshness, asOf, period, source, className, compact }: FreshnessBadgeProps) {
  const t = useTranslations("freshness");
  const locale = useLocale() as Locale;
  // Hover tooltips never open on touch: on phones the same details open on tap in a popover.
  const touch = useMediaQuery(MEDIA.coarse);
  const label = t(`states.${freshness}.label`);
  const style = STYLES[freshness];
  const badgeClass = cn(
    "caption-style inline-flex h-[20px] shrink-0 items-center gap-1 rounded-full normal-case tracking-normal border border-(--tag-neutral-border) bg-muted py-[3px] pr-[6px] pl-[5px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
    style.text,
    compact && "max-sm:px-[7px]",
    className,
  );
  const dot = <span aria-hidden className={cn("size-1.5 rounded-full", style.dot)} />;
  const text = compact ? <span className="max-sm:sr-only">{label}</span> : label;
  const details = (
    <div className="flex flex-col gap-0.5 py-0.5">
      <span className="font-medium">{label}</span>
      <span className="opacity-80">{t(`states.${freshness}.description`)}</span>
      <span className="num">{asOf ? t("asOf", { date: formatDate(asOf, locale) }) : t("noAsOf")}</span>
      {period && <span className="num">{t("period", { period: formatPeriod(period, locale) })}</span>}
      {source && <span className="opacity-80">{t("source", { source })}</span>}
    </div>
  );

  if (touch) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" aria-label={t("ariaLabel", { state: label })} data-freshness={freshness} className={cn(badgeClass, "relative after:absolute after:-inset-2.5 after:content-['']")}>
            {dot}
            {text}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="caption-style max-w-72 px-2 py-1.5 leading-[1.35] text-soft">{details}</PopoverContent>
      </Popover>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} role="status" aria-label={t("ariaLabel", { state: label })} data-freshness={freshness} className={badgeClass}>
          {dot}
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start">{details}</TooltipContent>
    </Tooltip>
  );
}
