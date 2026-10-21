"use client";

import { ExternalLink } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { stockHref } from "@/components/layout/nav-config";
import { DataState } from "@/components/feedback/data-state";
import { FilterBar, FilterSearch } from "@/components/layout/filter-bar";
import { SectionHeader } from "@/components/layout/section-header";
import { UrlTabs } from "@/components/layout/url-tabs";
import { Link } from "@/i18n/navigation";
import { useActionsCalendar, useAnnouncements, useNews } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatNumber, type Locale } from "@/lib/format";

/** Only http(s) links from the provider are rendered as links. */
const safeUrl = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null);

function NewsList() {
  const t = useTranslations("news");
  const locale = useLocale() as Locale;
  const query = useNews(30);
  return (
    <div className="flex flex-col gap-3" data-testid="news-list">
      <SectionHeader title={t("news")} meta={query.data ? freshnessMeta(query.data) : undefined} />
      <DataState query={query} compact isEmpty={(envelope) => envelope.data.length === 0}>
        {(envelope) => (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border px-4">
            {envelope.data.map((item, index) => {
              const url = safeUrl(item.url);
              return (
                <li key={`${item.title}-${index}`} className="flex flex-col gap-1 py-3">
                  <span className="num text-xs text-muted-foreground">{formatDate(item.date, locale)}</span>
                  {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium hover:underline">{item.title}<ExternalLink className="size-3" /></a> : <span className="text-sm font-medium">{item.title}</span>}
                  {item.summary && <p className="line-clamp-2 text-xs text-muted-foreground">{item.summary}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </DataState>
    </div>
  );
}

function AnnouncementList() {
  const t = useTranslations("news");
  const locale = useLocale() as Locale;
  const [q] = useQueryState("q", parseAsString.withDefault(""));
  const query = useAnnouncements(q.trim());
  return (
    <div className="flex flex-col gap-3" data-testid="announcement-list">
      <SectionHeader title={t("announcements")} meta={query.data ? freshnessMeta(query.data) : undefined} />
      {query.data?.freshness === "UNAVAILABLE" && <p className="caption-style text-subtle" data-testid="announcements-note">{t("announcementsNote")}</p>}
      <FilterBar><FilterSearch placeholder={t("keywords")} /></FilterBar>
      <DataState query={query} compact isEmpty={(envelope) => envelope.data.length === 0}>
        {(envelope) => (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border px-4">
            {envelope.data.map((item, index) => {
              const url = safeUrl(item.documentUrl);
              return (
                <li key={`${item.title}-${index}`} className="flex flex-col gap-1 py-3">
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="num">{formatDate(item.date, locale)}</span>
                    {item.symbol && <Link href={stockHref(item.symbol)} className="ticker text-link hover:underline">{item.symbol}</Link>}
                  </span>
                  <span className="text-sm">{item.title}</span>
                  {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-link hover:underline">{t("open")}<ExternalLink className="size-3" /></a>}
                </li>
              );
            })}
          </ul>
        )}
      </DataState>
    </div>
  );
}

/** Market-wide corporate actions by ex-date, from the Data Engine's calendar (its default window around today). */
function ActionsCalendar() {
  const t = useTranslations("news");
  const locale = useLocale() as Locale;
  const query = useActionsCalendar();
  return (
    <div className="flex flex-col gap-3" data-testid="actions-calendar">
      <SectionHeader title={t("calendar")} description={t("calendarHint")} meta={query.data ? freshnessMeta(query.data) : undefined} />
      <DataState query={query} compact isEmpty={(envelope) => envelope.data.length === 0}>
        {(envelope) => (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border px-4">
            {envelope.data.map((item, index) => {
              const url = safeUrl(item.documentUrl);
              return (
                <li key={`${item.symbol}-${item.date}-${item.type}-${index}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="num text-xs text-muted-foreground">{formatDate(item.date, locale)}</span>
                  <Link href={stockHref(item.symbol)} className="ticker text-link hover:underline">{item.symbol}</Link>
                  <span className="font-medium">{item.type === "DIVIDEND" ? t("actionDividend") : item.type === "SPLIT" ? t("actionSplit") : item.type}</span>
                  {item.amount !== null && <span className="num text-muted-foreground">{t("dividendAmount", { amount: formatNumber(item.amount, locale, { decimals: 2 }) })}</span>}
                  {item.ratio && <span className="num text-muted-foreground">{item.ratio}</span>}
                  {url && <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto text-xs text-link hover:underline"><ExternalLink className="size-3" /></a>}
                </li>
              );
            })}
          </ul>
        )}
      </DataState>
    </div>
  );
}

export function NewsView() {
  const t = useTranslations("news");
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="news-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} />
      <UrlTabs label={t("title")} tabs={[
        { value: "news", label: t("news"), content: <NewsList /> },
        { value: "calendar", label: t("calendar"), content: <ActionsCalendar /> },
        { value: "disclosures", label: t("announcements"), content: <AnnouncementList /> },
      ]} />
    </div>
  );
}
