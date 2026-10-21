"use client";

import { Bookmark, ChevronRight, LogIn } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { CriteriaList } from "@/components/data/screener-table";
import { StockRow } from "@/components/data/stock-row";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import type { ViewerSummary } from "@/components/layout/types";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { ChangeValue } from "@/components/market/change-value";
import { InsightCard } from "@/components/market/insight-card";
import { screenContextObservations, screenContextVersion } from "@/components/market/screen-context";
import { Link } from "@/i18n/navigation";
import { useMarketOverview, useNews, useQuotes, useSectors, useStrategies } from "@/lib/api/hooks";
import { useWatchlist } from "@/lib/watchlist";
import { QuoteList } from "@/components/data/quote-list";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatValue, type Locale } from "@/lib/format";
import { candidatesFor } from "@/lib/strategies/contract";

/** Home answers "what matters now" — each block shows its own freshness or why it can't. */
export function HomeView({ viewer }: { viewer: ViewerSummary }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const strategies = useStrategies();
  const market = useMarketOverview();
  const news = useNews();
  const sectors = useSectors();

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="home">
      <SectionHeader as="h1" title={t("home.title")} description={t("home.subtitle")} />

      <div className="grid gap-4 lg:grid-cols-2">
        <DataState query={strategies} compact>
          {(envelope) => <div data-testid="home-condition"><InsightCard className="h-full" title={t("home.marketCondition")} description={screenContextVersion(envelope.data.contexts)} observations={screenContextObservations(envelope.data.contexts, t, locale)} meta={freshnessMeta(envelope)} /></div>}
        </DataState>
        <Panel testId="home-indices" title={t("home.indices")} meta={market.data ? freshnessMeta(market.data) : undefined}>
          <DataState query={market} compact>
            {(envelope) => (
              <div className="flex flex-col gap-2">
                {envelope.data.indices.slice(0, 4).map((index) => (
                  <div key={index.code ?? index.name} className="flex h-row items-center justify-between gap-3 text-data">
                    <span className="ticker">{index.code ?? index.name}</span>
                    <span className="ticker ml-auto">{formatValue(index.close, "number", locale)}</span>
                    <ChangeValue percent={index.changePercent} className="w-20 justify-end" />
                  </div>
                ))}
                <p className="num text-xs text-muted-foreground">
                  {t("home.breadth", { adv: envelope.data.breadth.advancers, dec: envelope.data.breadth.decliners, unch: envelope.data.breadth.unchanged })}
                </p>
              </div>
            )}
          </DataState>
        </Panel>
      </div>

      <Panel testId="home-strategies" title={t("home.strategies")} description={t("home.strategiesHint")} meta={strategies.data ? freshnessMeta(strategies.data) : undefined}
        actions={<Link href="/discover/strategies" className="caption-style flex items-center gap-1 text-subtle transition-colors hover:text-foreground" data-testid="home-strategies-all">{t("home.viewAll")}<ChevronRight className="size-3" /></Link>}>
        <DataState query={strategies} compact isEmpty={(envelope) => envelope.data.strategies.length === 0}>
          {(envelope) => (
            <div className="flex flex-col gap-4">
              {envelope.data.strategies.slice(0, 3).map((strategy) => {
                const candidates = candidatesFor(envelope.data, strategy.id);
                return (
                  <div key={strategy.id} className="flex flex-col gap-1">
                    <Link href={`/discover/strategies/${strategy.id}`} className="lead-style flex items-center justify-between gap-2 font-medium hover:underline" data-testid={`home-strategy-${strategy.id}`}>
                      {strategy.label}
                      <span className="caption-style font-normal text-subtle">{t("strategy.matches", { count: candidates.length })}</span>
                    </Link>
                    {candidates.slice(0, 5).map((candidate) => (
                      <StockRow key={candidate.symbol} symbol={candidate.symbol} name={candidate.name} trailing={<span className="hidden sm:block"><CriteriaList reasons={candidate.reasons} /></span>} />
                    ))}
                  </div>
                );
              })}
              <ResearchDisclaimer />
            </div>
          )}
        </DataState>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel testId="home-movers" title={t("home.movers")} meta={market.data ? freshnessMeta(market.data) : undefined}>
          <DataState query={market} compact isEmpty={(envelope) => envelope.data.movers.length === 0}>
            {(envelope) => (
              <div className="flex flex-col">
                {envelope.data.movers.filter((mover) => mover.symbol).slice(0, 8).map((mover) => (
                  <StockRow key={mover.symbol} symbol={mover.symbol!} name={mover.name} price={mover.close} changePercent={mover.changePercent} />
                ))}
              </div>
            )}
          </DataState>
        </Panel>
        <Panel testId="home-sectors" title={t("home.sectors")} description={t("home.sectorsHint")} meta={sectors.data ? freshnessMeta(sectors.data) : undefined}>
          <DataState query={sectors} compact isEmpty={(envelope) => envelope.data.length === 0}>
            {(envelope) => (
              <ul className="flex flex-col divide-y divide-border" data-testid="home-sectors-list">
                {envelope.data.slice(0, 8).map((sector) => (
                  <li key={sector.sector} className="flex items-center justify-between gap-3 py-2">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm">{sector.sector}</span>
                      <span className="caption-style text-subtle">
                        {t("home.sectorBreadth", { up: sector.advancers, down: sector.decliners, stocks: sector.stocks })} · {formatIdr(sector.valueIdr, locale, { compact: true })}
                      </span>
                    </span>
                    <ChangeValue percent={sector.changePercent} className="shrink-0 text-sm" />
                  </li>
                ))}
              </ul>
            )}
          </DataState>
        </Panel>
        <Panel testId="home-watchlist" title={t("home.watchlist")}>
          <WatchlistActivity viewer={viewer} />
        </Panel>
      </div>

      <Panel testId="home-news" title={t("home.news")} meta={news.data ? freshnessMeta(news.data) : undefined}>
        <DataState query={news} compact isEmpty={(envelope) => envelope.data.length === 0}>
          {(envelope) => (
            <ul className="flex flex-col divide-y divide-border">
              {envelope.data.map((item, index) => (
                <li key={`${item.url ?? item.title}-${index}`} className="flex flex-col gap-0.5 py-2">
                  <span className="num text-xs text-muted-foreground">{formatDate(item.date, locale)}</span>
                  {item.url ? (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-sm hover:underline">{item.title}</a>
                  ) : (
                    <span className="text-sm">{item.title}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </DataState>
      </Panel>
    </div>
  );
}

function WatchlistActivity({ viewer }: { viewer: ViewerSummary }) {
  const t = useTranslations("home");
  const watchlist = useWatchlist(viewer.kind === "user" ? viewer.id : null);
  const items = (watchlist.data?.items ?? []).slice(0, 8);
  const quotes = useQuotes(items.map((item) => item.symbol));
  if (viewer.kind !== "user") return <EmptyState compact icon={<LogIn />} title={t("watchlistSignIn")} />;
  if (watchlist.isPending) return null;
  if (watchlist.isError || !items.length) return <EmptyState compact icon={<Bookmark />} title={t("watchlistEmpty")} />;
  return <QuoteList symbols={items.map((item) => ({ key: item.id, symbol: item.symbol }))} quotes={quotes.data?.data} />;
}
