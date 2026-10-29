"use client";

import { useLocale, useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { Panel } from "@/components/layout/panel";
import { ChangeValue } from "@/components/market/change-value";
import { Link } from "@/i18n/navigation";
import { useActionsCalendar, useMarketOverview, useNews } from "@/lib/api/hooks";
import { dayDiff, dayKey } from "@/lib/feed";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatValue, type Locale } from "@/lib/format";

function weekEnd(today: string): string {
  return new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
}

/** A dated briefing assembled from existing market feeds; each section keeps its own source state. */
export function MorningBrief({ today }: { today: string }) {
  const t = useTranslations("morningBrief");
  const locale = useLocale() as Locale;
  const market = useMarketOverview();
  const news = useNews(12);
  const actions = useActionsCalendar({ from: today, to: weekEnd(today) });

  return (
    <Panel title={t("title")} description={t("description", { date: formatDate(today, locale) })}
      meta={market.data ? freshnessMeta(market.data) : undefined} testId="morning-brief"
      actions={<Link href="/discover/feed" className="text-xs text-link hover:underline">{t("dailyFeed")}</Link>}>
      <div className="grid gap-4 lg:grid-cols-3">
        <section aria-label={t("marketTitle")} className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold">{t("marketTitle")}</h4>
          <DataState query={market} compact>
            {(envelope) => {
              const index = envelope.data.indices.find((row) => /^(IHSG|COMPOSITE|JKSE)$/i.test(row.code ?? "")) ?? envelope.data.indices[0];
              const session = dayKey(envelope.asOf);
              return (
                <div className="flex flex-col gap-2 text-sm">
                  <p className="text-xs text-muted-foreground">{session ? t("marketAsOf", { date: formatDate(session, locale) }) : t("dateUnknown")}</p>
                  {index ? <div className="flex items-center justify-between gap-2"><span className="ticker">{index.code ?? index.name}</span><span className="num ml-auto">{formatValue(index.close, "number", locale)}</span><ChangeValue percent={index.changePercent} /></div> : <p className="text-muted-foreground">{t("noMarket")}</p>}
                  <p className="text-muted-foreground">{t("breadth", { up: envelope.data.breadth.advancers, down: envelope.data.breadth.decliners, flat: envelope.data.breadth.unchanged })}</p>
                </div>
              );
            }}
          </DataState>
        </section>
        <section aria-label={t("newsTitle")} className="flex flex-col gap-2 lg:border-l lg:border-border lg:pl-4">
          <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">{t("newsTitle")}</h4><Link href="/news" className="text-xs text-link hover:underline">{t("seeAll")}</Link></div>
          <DataState query={news} compact>
            {(envelope) => {
              const fresh = envelope.data.filter((item) => {
                const date = dayKey(item.date);
                return item.title && date && dayDiff(date, today) >= 0 && dayDiff(date, today) <= 2;
              }).slice(0, 3);
              return fresh.length ? <ul className="flex flex-col gap-2 text-sm">{fresh.map((item, index) => {
                const url = item.url && /^https?:\/\//i.test(item.url) ? item.url : null;
                return <li key={`${item.title}-${index}`} className="flex flex-col gap-0.5 border-b border-border pb-2 last:border-0">
                  {url ? <a href={url} target="_blank" rel="noopener noreferrer" className="line-clamp-2 hover:underline">{item.title}</a> : <span className="line-clamp-2">{item.title}</span>}
                  <span className="text-xs text-muted-foreground">{formatDate(dayKey(item.date)!, locale)}</span>
                </li>;
              })}</ul> : <p className="text-sm text-muted-foreground">{t("noRecentNews")}</p>;
            }}
          </DataState>
        </section>
        <section aria-label={t("agendaTitle")} className="flex flex-col gap-2 lg:border-l lg:border-border lg:pl-4">
          <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold">{t("agendaTitle")}</h4><Link href="/news" className="text-xs text-link hover:underline">{t("seeAll")}</Link></div>
          <DataState query={actions} compact>
            {(envelope) => {
              const upcoming = envelope.data.filter((item) => item.date >= today && item.date <= weekEnd(today)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
              return upcoming.length ? <ul className="flex flex-col gap-2 text-sm">{upcoming.map((item, index) => <li key={`${item.symbol}-${item.date}-${item.type}-${index}`} className="flex items-center gap-2 border-b border-border pb-2 last:border-0">
                <span className="ticker font-medium">{item.symbol}</span><span className="min-w-0 flex-1 truncate">{item.description ?? item.type}</span><time className="num shrink-0 text-xs text-muted-foreground" dateTime={item.date}>{formatDate(item.date, locale)}</time>
              </li>)}</ul> : <p className="text-sm text-muted-foreground">{t("noAgenda")}</p>;
            }}
          </DataState>
        </section>
      </div>
    </Panel>
  );
}
