"use client";

import { TriangleAlert } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { GroupPerformance, GroupStock } from "@/lib/api/market";
import { formatIdr, formatPercent, type Locale } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Signed rupiah: "+Rp1,2 M" / "-Rp987 M" (the sign is the direction of the net foreign estimate). */
export function signedIdr(value: number | null, locale: Locale): string {
  const text = formatIdr(value, locale, { compact: true });
  return value !== null && value > 0 && text !== formatIdr(0, locale, { compact: true }) ? `+${text}` : text;
}

/** The group's localized display name. */
export function groupName(group: Pick<GroupPerformance, "name">, locale: Locale): string {
  return locale === "id" ? group.name.id : group.name.en;
}

/** A membership the curator could not confirm from a public source. */
export function UnverifiedBadge({ className }: { className?: string }) {
  const t = useTranslations("groups");
  return (
    <Badge variant="outline" title={t("unverifiedHint")} className={cn("h-4 border-dashed px-1.5 text-[10px] font-normal text-muted-foreground", className)} data-testid="group-unverified">
      {t("unverified")}
    </Badge>
  );
}

/**
 * Says in words when price and the foreign estimate point opposite ways. A fact, not a verdict: no phase or action
 * label is derived from it.
 */
export function DivergenceCallout({ group, compact = false }: { group: Pick<GroupPerformance, "divergence" | "valueWeightedChangePercent" | "changePercent" | "foreign">; compact?: boolean }) {
  const t = useTranslations("groups");
  const locale = useLocale() as Locale;
  if (!group.divergence) return null;
  const change = formatPercent(group.valueWeightedChangePercent ?? group.changePercent, locale);
  const foreign = signedIdr(group.foreign.netValueEstimateIdr, locale);
  return (
    <p role="note" data-testid="group-divergence" data-divergence={group.divergence}
      className={cn("flex items-start gap-1.5 rounded-md border border-warning/50 bg-warning-muted text-foreground", compact ? "px-2 py-1 text-[11px]" : "px-3 py-2 text-xs")}>
      <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0 text-warning" />
      <span>{compact ? t(`divergenceShort.${group.divergence}`) : t(`divergence.${group.divergence}`, { change, foreign })}</span>
    </p>
  );
}

/** Per-stock version, short. */
export function StockDivergence({ stock }: { stock: Pick<GroupStock, "divergence"> }) {
  const t = useTranslations("groups");
  if (!stock.divergence) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-foreground" data-testid="stock-divergence">
      <TriangleAlert aria-hidden className="size-3 text-warning" />
      {t(`divergenceShort.${stock.divergence}`)}
    </span>
  );
}
