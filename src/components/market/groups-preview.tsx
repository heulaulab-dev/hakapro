"use client";

import { ChevronRight } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { Panel } from "@/components/layout/panel";
import { ChangeValue } from "@/components/market/change-value";
import { DivergenceCallout, groupName, signedIdr, UnverifiedBadge } from "@/components/market/group-parts";
import { Link } from "@/i18n/navigation";
import { useGroups } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import type { Locale } from "@/lib/format";

const PREVIEW_GROUPS = 8;

/**
 * Compact home-page panel: the top conglomerate groups by 1D value-weighted change, with the net foreign estimate and
 * a short note where price and foreign flow disagree. Self-contained (own query and panel); links to the full page.
 */
export function GroupsPreview({ className }: { className?: string }) {
  const t = useTranslations("groups");
  const locale = useLocale() as Locale;
  const query = useGroups("1D");
  return (
    <Panel testId="home-groups" className={className} title={t("previewTitle")} description={t("previewHint")} meta={query.data ? freshnessMeta(query.data) : undefined}
      actions={<Link href="/discover/groups" className="caption-style flex items-center gap-1 text-subtle transition-colors hover:text-foreground" data-testid="home-groups-all">{t("viewAll")}<ChevronRight className="size-3" /></Link>}>
      <DataState query={query} compact isEmpty={(envelope) => envelope.data.groups.every((group) => group.membersWithData === 0)}>
        {(envelope) => (
          <ul className="flex flex-col divide-y divide-border" data-testid="home-groups-list">
            {envelope.data.groups.filter((group) => group.membersWithData > 0).slice(0, PREVIEW_GROUPS).map((group) => (
              <li key={group.id} className="flex flex-col gap-1 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 truncate text-sm">{groupName(group, locale)}{group.confidence === "unverified" && <UnverifiedBadge />}</span>
                    <span className="caption-style text-subtle">
                      {t("previewBreadth", { up: group.advancers, down: group.decliners, count: group.membersWithData })}
                      {group.foreign.netValueEstimateIdr !== null && <> · {t("previewForeign", { value: signedIdr(group.foreign.netValueEstimateIdr, locale) })}</>}
                    </span>
                  </span>
                  <ChangeValue percent={group.valueWeightedChangePercent ?? group.changePercent} className="shrink-0 text-sm" />
                </div>
                <DivergenceCallout group={group} compact />
              </li>
            ))}
          </ul>
        )}
      </DataState>
    </Panel>
  );
}
