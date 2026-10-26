"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import { Tag, type TagColor } from "@/components/kit/tag";
import { StatusBadge } from "@/components/feedback/status-badge";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import { Button } from "@/components/ui/button";
import type { HolderGroup, HolderKind } from "@/lib/insider-holders";
import type { FreshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatPercent, formatVolume, type Locale } from "@/lib/format";
import { cn } from "@/lib/utils";

const KIND_COLOR: Record<HolderKind, TagColor> = { organization: "blue", person: "purple", nominee: "amber", unknown: "neutral" };

export type HolderCoverage = { loaded: number; total: number; canLoadOlder: boolean; loadingOlder: boolean; olderUnavailable: boolean; onLoadOlder: () => void };

/**
 * Disclosed insider transactions grouped by holder. Every row carries its source and as-of date; identity is never
 * inferred (people are grouped by exact name and labelled unverified), nominee accounts are never shown as owners,
 * and contradictory same-day holdings are shown as ambiguous with every value.
 */
export function InsiderHolders({ groups, meta, coverage }: { groups: HolderGroup[]; meta: FreshnessMeta; coverage: HolderCoverage }) {
  const t = useTranslations("insiderHolders");
  const tActions = useTranslations("insiders.actions");
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  // Small insider stakes need 4 decimals (0.0063%); major holdings read better with 2 (61.13%).
  const percent = (value: number | null) => formatPercent(value, locale, { decimals: value !== null && Math.abs(value) < 1 ? 4 : 2, signed: false });

  return (
    <div data-testid="insider-holders" className="flex flex-col overflow-hidden rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-cell-x py-2">
        <span className="caption-style text-subtle" data-testid="holder-coverage">
          {coverage.loaded >= coverage.total ? t("coverageAll", { total: coverage.total }) : t("coverage", { loaded: coverage.loaded, total: coverage.total })}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="caption-style num text-subtle" data-testid="holder-count">{t("count", { count: groups.length })}</span>
          <FreshnessBadge {...meta} />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table aria-label={t("title")} className="w-full border-separate border-spacing-0 text-data">
          <thead>
            <tr>
              <th scope="col" className="caption-style h-[38px] w-8 border-b border-border px-2 font-normal" />
              <th scope="col" className="caption-style h-[38px] border-b border-border px-3 text-left font-normal text-subtle">{t("holder")}</th>
              <th scope="col" className="caption-style h-[38px] border-b border-border px-3 text-right font-normal whitespace-nowrap text-subtle">{t("latest")}</th>
              <th scope="col" className="caption-style hidden h-[38px] border-b border-border px-3 text-left font-normal whitespace-nowrap text-subtle sm:table-cell">{t("asOf")}</th>
              <th scope="col" className="caption-style hidden h-[38px] border-b border-border px-3 text-right font-normal text-subtle sm:table-cell">{t("disclosures")}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const expanded = open.has(group.key);
              const name = group.names[0];
              return (
                <Fragment key={group.key}>
                  <tr className="align-top transition-colors hover:bg-(--overlay-soft)" data-testid="holder-row" data-kind={group.kind}>
                    <td className="border-b border-border px-2 py-cell-y">
                      <Button variant="ghost" size="icon" className="size-7" aria-expanded={expanded} aria-label={expanded ? t("hideHistory", { name }) : t("showHistory", { name })} onClick={() => toggle(group.key)}>
                        {expanded ? <ChevronDown /> : <ChevronRight />}
                      </Button>
                    </td>
                    <td className="border-b border-border px-3 py-cell-y">
                      <div className="flex flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium" data-testid="holder-name">{name}</span>
                          <Tag size="sm" color={KIND_COLOR[group.kind]}>{t(`kinds.${group.kind}`)}</Tag>
                          {group.roles.map((role) => <Tag key={role} size="sm">{t(`roles.${role}`)}</Tag>)}
                          {group.otherBadges.map((badge) => <Tag key={badge} size="sm">{badge}</Tag>)}
                        </span>
                        {group.names.length > 1 && <span className="text-[11px] text-muted-foreground">{t("variants", { names: group.names.slice(1).join(" · ") })}</span>}
                        {group.kind === "nominee" && <span className="text-[11px] text-muted-foreground" data-testid="nominee-note">{t("nomineeNote")}</span>}
                        {group.identityUnverified && <span className="text-[11px] text-muted-foreground">{t("unverified")}</span>}
                        {group.possiblySameAs.length > 0 && <span className="text-[11px] text-muted-foreground">{t("possiblySame", { names: group.possiblySameAs.join(" · ") })}</span>}
                      </div>
                    </td>
                    <td className="ticker border-b border-border px-3 py-cell-y text-right whitespace-nowrap">
                      {group.latest.ambiguous ? (
                        <span className="flex flex-col items-end gap-1" data-testid="holding-ambiguous" title={t("ambiguousNote", { date: formatDate(group.latest.date, locale) })}>
                          <StatusBadge tone="warning">{t("ambiguous")}</StatusBadge>
                          {group.latest.holdings.map((holding, index) => <span key={index}>{percent(holding.percent)}</span>)}
                        </span>
                      ) : (
                        <span className="flex flex-col items-end">
                          <span>{percent(group.latest.holdings[0]?.percent ?? null)}</span>
                          <span className="text-[11px] text-muted-foreground">{formatVolume(group.latest.holdings[0]?.shares ?? null, locale, { compact: true })}</span>
                          <span className="num text-[11px] text-muted-foreground sm:hidden">{formatDate(group.latest.date, locale)}</span>
                        </span>
                      )}
                    </td>
                    <td className="num hidden border-b border-border px-3 py-cell-y whitespace-nowrap sm:table-cell">{formatDate(group.latest.date, locale)}</td>
                    <td className="num hidden border-b border-border px-3 py-cell-y text-right whitespace-nowrap sm:table-cell">{group.events.length}</td>
                  </tr>
                  {expanded && (
                    <tr data-testid="holder-history">
                      <td />
                      <td colSpan={4} className="border-b border-border bg-(--overlay-soft) px-3 py-2">
                        {group.latest.ambiguous && <p className="mb-2 text-xs text-muted-foreground">{t("ambiguousNote", { date: formatDate(group.latest.date, locale) })}</p>}
                        <ul className="flex flex-col divide-y divide-border text-xs">
                          {group.events.map((event, index) => (
                            <li key={index} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                              <span className="num w-24 text-muted-foreground">{formatDate(event.date, locale)}</span>
                              <StatusBadge tone={event.action === "BUY" ? "positive" : event.action === "SELL" ? "negative" : "neutral"}>{tActions(event.action)}</StatusBadge>
                              {group.names.length > 1 && <span className="text-muted-foreground">{event.person}</span>}
                              <span className="ticker ml-auto">{formatVolume(event.changeShares, locale, { compact: true, signed: true })}</span>
                              <span className="ticker w-24 text-right">{percent(event.previousPercent)} → {percent(event.currentPercent)}</span>
                              <span className="ticker w-20 text-right text-muted-foreground">{formatIdr(event.priceIdr, locale)}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="caption-style mt-2 text-subtle">{t("source", { source: meta.source, first: formatDate(group.firstDate, locale), last: formatDate(group.latest.date, locale) })}</p>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={cn("flex flex-wrap items-center gap-2 px-cell-x py-2", groups.length > 0 && "border-t border-border")}>
        <p className="text-[11px] text-muted-foreground">{t("note")}</p>
        {coverage.olderUnavailable && <p className="text-[11px] text-muted-foreground" data-testid="older-unavailable">{t("olderUnavailable")}</p>}
        {coverage.canLoadOlder && (
          <Button className="ml-auto" variant="outline" size="sm" disabled={coverage.loadingOlder} onClick={coverage.onLoadOlder} data-testid="load-older">{t("loadOlder")}</Button>
        )}
      </div>
    </div>
  );
}
