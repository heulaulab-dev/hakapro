"use client";

import { UserRoundSearch } from "@/components/kit/icons";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { InsidersTable } from "@/components/data/insiders-table";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { stockHref } from "@/components/layout/nav-config";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Link } from "@/i18n/navigation";
import { useRecentInsiders } from "@/lib/api/hooks";
import type { RecentInsiders } from "@/lib/api/market";
import type { WithFreshness } from "@/lib/freshness";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatVolume, type Locale } from "@/lib/format";
import { topInsiderBuys } from "@/lib/insider-feed";

const DAYS = 7;
const FILTERS = ["all", "buy", "sell"] as const;
type Filter = (typeof FILTERS)[number];
/** The engine's largest page: enough to rank a week's buys by value for the preview. */
const PREVIEW_FETCH = 200;
const PREVIEW_ROWS = 8;

/** True for the engine's empty form: nothing has been read yet, so nothing can be said about the market. */
const notRunning = (envelope: WithFreshness<RecentInsiders>) => envelope.asOf === null && envelope.data.coverage.checked === 0;

function Coverage({ data }: { data: RecentInsiders }) {
  const t = useTranslations("insiderFeed");
  const locale = useLocale() as Locale;
  return (
    <p className="caption-style text-subtle" data-testid="insider-feed-coverage">
      {t("coverage", { checked: data.coverage.checked, active: data.coverage.active })}
      {data.coverage.oldestCheck && <> {t("oldest", { days: data.coverage.revisitDays, date: formatDate(data.coverage.oldestCheck, locale) })}</>}
      {" "}{t("window", { from: formatDate(data.from, locale), to: formatDate(data.to, locale) })}
    </p>
  );
}

/**
 * Market-wide "insider transactions, 7 days" (Data Engine rotation over arjum) with buy/sell tabs. States plainly how
 * much of the market the rotation covers and when it last read; never implies a complete market view.
 */
export function InsiderFeedSection() {
  const t = useTranslations("insiderFeed");
  const tInsiders = useTranslations("insiders");
  const [filter, setFilter] = useState<Filter>("all");
  const query = useRecentInsiders({ days: DAYS, action: filter === "all" ? undefined : filter, limit: 100 });
  return (
    <section className="flex flex-col gap-3" data-testid="insider-feed">
      <SectionHeader title={t("title")} description={t("hint")} meta={query.data ? freshnessMeta(query.data) : undefined} />
      <DataState query={query} compact>
        {(envelope) => notRunning(envelope) ? <EmptyState compact icon={<UserRoundSearch />} title={t("notRunning")} /> : (
          <div className="flex flex-col gap-2">
            <Coverage data={envelope.data} />
            {envelope.data.transactions.length === 0 && filter === "all"
              ? <EmptyState compact title={t("none", { days: DAYS })} />
              : (
                <InsidersTable testId="insider-feed-table" rows={envelope.data.transactions} meta={freshnessMeta(envelope)} showSymbol showValue
                  toolbar={
                    <ToggleGroup type="single" size="sm" variant="outline" value={filter} onValueChange={(value) => { if (value) setFilter(value as Filter); }} aria-label={t("filter")}>
                      {FILTERS.map((value) => (
                        <ToggleGroupItem key={value} value={value} className="px-2.5 text-xs" data-testid={`insider-feed-${value}`}>
                          {value === "all" ? t("all") : tInsiders(`actions.${value === "buy" ? "BUY" : "SELL"}`)}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  } />
              )}
          </div>
        )}
      </DataState>
    </section>
  );
}

/**
 * Compact dashboard panel: the week's largest insider purchases by value (|shares| × price), top 8, with the feed's
 * coverage. Purchases without a price have no value and are left out rather than ranked as zero.
 */
export function InsiderFeedPreview({ className }: { className?: string }) {
  const t = useTranslations("insiderFeed");
  const locale = useLocale() as Locale;
  const query = useRecentInsiders({ days: DAYS, action: "buy", limit: PREVIEW_FETCH });
  return (
    <Panel testId="insider-feed-preview" className={className} title={t("previewTitle")} meta={query.data ? freshnessMeta(query.data) : undefined}
      actions={<Link href="/discover/ownership" className="caption-style text-link hover:underline">{t("seeAll")}</Link>}>
      <DataState query={query} compact>
        {(envelope) => {
          if (notRunning(envelope)) return <EmptyState compact icon={<UserRoundSearch />} title={t("notRunning")} />;
          const top = topInsiderBuys(envelope.data.transactions, PREVIEW_ROWS);
          return (
            <div className="flex flex-col gap-2">
              <p className="caption-style leading-snug text-subtle">{t("previewHint", { checked: envelope.data.coverage.checked, active: envelope.data.coverage.active })}</p>
              {top.length === 0 ? <EmptyState compact title={t("previewNone")} /> : (
                <ul className="flex flex-col divide-y divide-border" data-testid="insider-feed-preview-list">
                  {top.map((row) => (
                    <li key={`${row.symbol}-${row.date}-${row.person}-${row.changeShares}`} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex min-w-0 flex-col">
                        <span className="flex min-w-0 items-center gap-2 text-sm">
                          <Link href={stockHref(row.symbol, "insiders")} className="ticker shrink-0 text-link hover:underline">{row.symbol}</Link>
                          <span className="truncate" title={row.person}>{row.person}</span>
                        </span>
                        <span className="caption-style text-subtle">
                          {formatDate(row.date, locale)} · {formatVolume(row.changeShares, locale, { compact: true, signed: true })}{row.roles.length > 0 ? ` · ${row.roles.join(", ")}` : ""}
                        </span>
                      </span>
                      <span className="num shrink-0 text-sm">{formatIdr(row.valueIdr, locale, { compact: true })}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        }}
      </DataState>
    </Panel>
  );
}
