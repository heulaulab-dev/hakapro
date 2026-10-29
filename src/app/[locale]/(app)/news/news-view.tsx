"use client";

import { ExternalLink, Landmark } from "@/components/kit/icons";
import { parseAsString, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { stockHref } from "@/components/layout/nav-config";
import { DataState } from "@/components/feedback/data-state";
import { FilterBar, FilterSearch } from "@/components/layout/filter-bar";
import { SectionHeader } from "@/components/layout/section-header";
import { UrlTabs } from "@/components/layout/url-tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/kit/tag";
import { Link } from "@/i18n/navigation";
import { useActionsCalendar, useAnnouncements, useNews } from "@/lib/api/hooks";
import type { ActionCalendarItem } from "@/lib/api/market";
import { countdown, dayKey, formatWeekday, groupByDay, isThisWeek, monogram, outletHost, relativeAge, relativeDay, todayWib, weekDays } from "@/lib/feed";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatShortDate, type Locale } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Only http(s) links from the provider are rendered as links. */
const safeUrl = (url: string | null) => (url && /^https?:\/\//i.test(url) ? url : null);

const chipClass = "ticker inline-flex min-h-10 items-center rounded-md border border-border bg-secondary px-2 text-xs text-link outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60 md:min-h-7";

/** Sticky day header: relative label first, then the weekday and date. */
function DayHeader({ day, today, count, emphasised }: { day: string | null; today: string; count?: number; emphasised?: boolean }) {
  const t = useTranslations("news");
  const locale = useLocale() as Locale;
  const label = day ? relativeDay(day, today) : null;
  const relative = label && label.kind !== "date" ? t(label.kind) : null;
  return (
    <h3 className={cn("sticky top-0 z-10 -mx-1 flex items-baseline gap-2 border-b border-border bg-background/95 px-1 py-2 backdrop-blur", emphasised && "border-l-2 border-l-foreground pl-3")} data-testid="day-header">
      {day ? (
        <>
          <span className="text-sm font-medium">{relative ?? formatWeekday(day, locale)}</span>
          <span className="num text-xs text-muted-foreground">{relative ? `${formatWeekday(day, locale)}, ` : ""}{formatDate(day, locale)}</span>
        </>
      ) : <span className="text-sm font-medium">{t("undated")}</span>}
      {count !== undefined && <span className="num ml-auto text-xs text-muted-foreground">{count}</span>}
    </h3>
  );
}

function FeedSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-4" data-testid="feed-skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-9 shrink-0 rounded-lg" />
          <div className="flex flex-1 flex-col gap-2"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-4 w-11/12" /><Skeleton className="h-3 w-2/3" /></div>
        </div>
      ))}
    </div>
  );
}

function NewsList() {
  const t = useTranslations("news");
  const locale = useLocale() as Locale;
  const query = useNews(30);
  const today = todayWib();
  return (
    <section className="flex flex-col gap-3" data-testid="news-list" aria-labelledby="news-heading">
      <SectionHeader title={<span id="news-heading">{t("news")}</span>} meta={query.data ? freshnessMeta(query.data) : undefined} />
      <DataState query={query} compact skeleton={<FeedSkeleton />} isEmpty={(envelope) => envelope.data.length === 0}>
        {(envelope) => {
          const items = envelope.data.filter((item) => item.title);
          const groups = groupByDay(items, (item) => item.date);
          let first = true;
          return (
            <div className="flex flex-col gap-2">
              {groups.map((group) => (
                <div key={group.day ?? "undated"} className="flex flex-col">
                  <DayHeader day={group.day} today={today} count={group.items.length} />
                  <ul className="flex flex-col divide-y divide-border">
                    {group.items.map((item, index) => {
                      const featured = first;
                      first = false;
                      const url = safeUrl(item.url);
                      const host = outletHost(item.url);
                      const age = relativeAge(item.date);
                      const ageText = age ? t(age.unit === "minute" ? "minutesAgo" : age.unit === "hour" ? "hoursAgo" : "daysAgo", { n: age.value }) : null;
                      const absolute = item.date ? formatDate(item.date, locale) : undefined;
                      const symbols = (item.symbols ?? []).slice(0, 6);
                      const headline = item.title ?? "";
                      return (
                        <li key={`${headline}-${index}`} className={cn("relative flex gap-3 py-3 transition-colors hover:bg-accent/40", featured && "py-4")} data-featured={featured || undefined}>
                          <span aria-hidden className={cn("mt-0.5 flex shrink-0 items-center justify-center rounded-lg border border-border bg-secondary text-[11px] font-medium tracking-wide text-soft", featured ? "size-11" : "size-9")}>{monogram(host)}</span>
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                              {featured && <Tag size="sm" color="blue">{t("latest")}</Tag>}
                              <span className="truncate">{host ?? t("unknownOutlet")}</span>
                              {(ageText || absolute) && <span aria-hidden>·</span>}
                              {(ageText || absolute) && <time className="num" dateTime={item.date ?? undefined} title={absolute}>{ageText ?? absolute}</time>}
                            </div>
                            {url ? (
                              <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${headline} (${t("readArticle", { outlet: host ?? "" })})`}
                                className={cn("line-clamp-2 rounded-sm font-medium leading-snug text-foreground outline-none after:absolute after:inset-0 hover:underline focus-visible:ring-2 focus-visible:ring-ring/60", featured ? "text-base md:text-lg" : "text-[15px]")}>
                                {headline}<ExternalLink aria-hidden className="ml-1 inline size-3 align-baseline text-muted-foreground" />
                              </a>
                            ) : <span className={cn("line-clamp-2 font-medium leading-snug", featured ? "text-base md:text-lg" : "text-[15px]")}>{headline}</span>}
                            {item.summary && <p className={cn("text-sm leading-snug text-muted-foreground", featured ? "line-clamp-3" : "line-clamp-2")}>{item.summary}</p>}
                            {symbols.length > 0 && (
                              <ul className="relative z-10 flex flex-wrap gap-1.5 pt-1" aria-label={t("symbolsLabel")}>
                                {symbols.map((symbol) => <li key={symbol}><Link href={stockHref(symbol)} className={chipClass}>{symbol}</Link></li>)}
                              </ul>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          );
        }}
      </DataState>
    </section>
  );
}

function AnnouncementList() {
  const t = useTranslations("news");
  const locale = useLocale() as Locale;
  const [q] = useQueryState("q", parseAsString.withDefault(""));
  const query = useAnnouncements(q.trim());
  return (
    <section className="flex flex-col gap-4" data-testid="announcement-list" aria-labelledby="disclosures-heading">
      <SectionHeader title={<span id="disclosures-heading">{t("announcements")}</span>} meta={query.data ? freshnessMeta(query.data) : undefined} />
      <div className="flex items-start gap-4 rounded-xl border border-dashed border-border bg-secondary/40 p-4 md:p-5">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-soft"><Landmark className="size-5" /></span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 className="text-sm font-medium">{t("disclosuresTitle")}</h3>
          <p className="text-sm leading-snug text-muted-foreground" data-testid="announcements-note">{t("announcementsNote")}</p>
          <a href="https://www.idx.co.id" target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex min-h-10 items-center gap-1 self-start rounded-sm text-sm text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 md:min-h-0">{t("openIdx")}<ExternalLink aria-hidden className="size-3" /></a>
        </div>
      </div>
      {query.data && query.data.data.length > 0 && <FilterBar><FilterSearch placeholder={t("keywords")} /></FilterBar>}
      <DataState query={query} compact skeleton={<FeedSkeleton rows={3} />} isEmpty={(envelope) => envelope.data.length === 0}>
        {(envelope) => {
          const groups = groupByDay(envelope.data, (item) => item.date);
          const today = todayWib();
          return (
            <div className="flex flex-col gap-2">
              {groups.map((group) => (
                <div key={group.day ?? "undated"} className="flex flex-col">
                  <DayHeader day={group.day} today={today} />
                  <ul className="flex flex-col divide-y divide-border">
                    {group.items.map((item, index) => {
                      const url = safeUrl(item.documentUrl);
                      return (
                        <li key={`${item.title}-${index}`} className="flex flex-col gap-1 py-3">
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="num">{formatDate(item.date, locale)}</span>
                            {item.symbol && <Link href={stockHref(item.symbol)} className={chipClass}>{item.symbol}</Link>}
                          </span>
                          <span className="text-sm">{item.title}</span>
                          {url && <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center gap-1 self-start text-xs text-link hover:underline md:min-h-0">{t("open")}<ExternalLink aria-hidden className="size-3" /></a>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          );
        }}
      </DataState>
    </section>
  );
}

/** Seven-day strip of the current week with a count per day that has events; days are anchors to the agenda. */
function WeekStrip({ today, items }: { today: string; items: ActionCalendarItem[] }) {
  const t = useTranslations("news");
  const locale = useLocale() as Locale;
  const counts = new Map<string, number>();
  for (const item of items) { const key = dayKey(item.date); if (key) counts.set(key, (counts.get(key) ?? 0) + 1); }
  return (
    <ol aria-label={t("weekStrip")} className="grid grid-cols-7 gap-1 rounded-xl border border-border p-1.5" data-testid="week-strip">
      {weekDays(today).map((day) => {
        const count = counts.get(day) ?? 0;
        const isToday = day === today;
        const body = (
          <>
            <span className="text-[11px] uppercase text-muted-foreground">{formatWeekday(day, locale, "short")}</span>
            <span className={cn("num text-sm font-medium", isToday && "underline underline-offset-4")}>{day.slice(8)}</span>
            <span aria-hidden className={cn("h-1.5 rounded-full", count > 0 ? "w-4 bg-foreground" : "w-1.5 bg-border")} />
            {count > 0 && <span className="sr-only">{t("eventsOnDay", { count })}</span>}
          </>
        );
        const cls = cn("flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-lg outline-none", isToday && "bg-secondary", count > 0 && "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60");
        return (
          <li key={day} aria-current={isToday ? "date" : undefined}>
            {count > 0 ? <a href={`#cal-${day}`} className={cn(cls, "w-full")}>{body}</a> : <div className={cls}>{body}</div>}
          </li>
        );
      })}
    </ol>
  );
}

function ExCountdown({ day, today }: { day: string; today: string }) {
  const t = useTranslations("news");
  const c = countdown(day, today);
  const text = c.kind === "today" ? t("exToday") : c.kind === "in" ? (c.days === 1 ? t("exInOne") : t("exIn", { days: c.days })) : c.days === 1 ? t("exAgoOne") : t("exAgo", { days: c.days });
  return <span className={cn("num text-xs", c.kind === "ago" ? "text-muted-foreground" : "font-medium text-foreground")} data-testid="ex-countdown">{text}</span>;
}

/** Market-wide corporate actions by ex-date, from the Data Engine's calendar (its default window around today). */
function ActionsCalendar() {
  const t = useTranslations("news");
  const locale = useLocale() as Locale;
  const query = useActionsCalendar();
  const today = todayWib();
  return (
    <section className="flex flex-col gap-3" data-testid="actions-calendar" aria-labelledby="calendar-heading">
      <SectionHeader title={<span id="calendar-heading">{t("calendar")}</span>} description={t("calendarHint")} meta={query.data ? freshnessMeta(query.data) : undefined} />
      <DataState query={query} compact skeleton={<FeedSkeleton rows={4} />} isEmpty={(envelope) => envelope.data.length === 0}>
        {(envelope) => {
          const groups = groupByDay(envelope.data, (item) => item.date, "asc");
          return (
            <div className="flex flex-col gap-4">
              <WeekStrip today={today} items={envelope.data} />
              {groups.map((group) => {
                const week = group.day ? isThisWeek(group.day, today) : false;
                return (
                  <div key={group.day ?? "undated"} id={group.day ? `cal-${group.day}` : undefined} className="flex scroll-mt-14 flex-col">
                    <DayHeader day={group.day} today={today} count={group.items.length} emphasised={week} />
                    <ul className="flex flex-col divide-y divide-border">
                      {group.items.map((item, index) => {
                        const url = safeUrl(item.documentUrl);
                        const dividend = item.type === "DIVIDEND";
                        const split = item.type === "SPLIT";
                        return (
                          <li key={`${item.symbol}-${item.date}-${item.type}-${index}`} className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3", !week && "opacity-90")}>
                            <Link href={stockHref(item.symbol)} className="ticker inline-flex min-h-10 min-w-16 items-center rounded-sm text-base font-semibold text-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 md:min-h-0">{item.symbol}</Link>
                            <Tag size="sm" color={dividend ? "blue" : split ? "purple" : "neutral"}>{dividend ? t("actionDividend") : split ? t("actionSplit") : item.type}</Tag>
                            <span className="flex flex-1 flex-wrap items-baseline justify-end gap-x-3 gap-y-0.5 text-right">
                              {item.amount !== null && (
                                <span className="num"><span className="text-lg font-semibold">{formatIdr(item.amount, locale, { decimals: 2 })}</span> <span className="text-xs text-muted-foreground">{t("perShareLabel")}</span></span>
                              )}
                              {item.ratio && <span className="num text-lg font-semibold">{item.ratio}</span>}
                              {group.day && <ExCountdown day={group.day} today={today} />}
                            </span>
                            {url && <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`${t("openDocument")}: ${item.symbol}`} title={formatShortDate(item.date, locale)} className="inline-flex size-10 items-center justify-center rounded-md text-link hover:bg-accent md:size-7"><ExternalLink aria-hidden className="size-3.5" /></a>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          );
        }}
      </DataState>
    </section>
  );
}

function TabLabel({ text, count }: { text: string; count?: number }) {
  return <span className="inline-flex items-center gap-1.5">{text}{count !== undefined && count > 0 && <span className="num rounded-full bg-secondary px-1.5 py-0.5 text-[11px] leading-none text-muted-foreground">{count}</span>}</span>;
}

export function NewsView() {
  const t = useTranslations("news");
  // Same query keys as the tab contents, so these share their cache entries and cost no extra requests.
  const news = useNews(30);
  const calendar = useActionsCalendar();
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="news-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} />
      <UrlTabs label={t("title")} tabs={[
        { value: "news", label: <TabLabel text={t("news")} count={news.data?.data.length} />, content: <NewsList /> },
        { value: "calendar", label: <TabLabel text={t("calendar")} count={calendar.data?.data.length} />, content: <ActionsCalendar /> },
        { value: "disclosures", label: <TabLabel text={t("announcements")} />, content: <AnnouncementList /> },
      ]} />
    </div>
  );
}
