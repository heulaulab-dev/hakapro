"use client";

import { useQuery } from "@tanstack/react-query";
import { BarChart3, Bookmark, ChevronRight, LogIn } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { CriteriaList } from "@/components/data/screener-table";
import { StockRow } from "@/components/data/stock-row";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import type { ViewerSummary } from "@/components/layout/types";
import { SectionHeader } from "@/components/layout/section-header";
import { ChangeValue } from "@/components/market/change-value";
import { InsightCard } from "@/components/market/insight-card";
import { screenContextObservations } from "@/components/market/screen-context";
import { Link } from "@/i18n/navigation";
import { useMarketOverview, useNews, useStrategies } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatValue, type Locale } from "@/lib/format";
import { queryKeys } from "@/lib/query/keys";
import { createClient } from "@/lib/supabase/client";

function Panel({ children, testId, className }: { children: ReactNode; testId: string; className?: string }) {
  return <section data-testid={testId} className={`flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-card p-4 ${className ?? ""}`}>{children}</section>;
}

/** Home answers "what matters now" — each block shows its own freshness or why it can't. */
export function HomeView({ viewer }: { viewer: ViewerSummary }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const strategies = useStrategies();
  const market = useMarketOverview();
  const news = useNews();

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="home">
      <SectionHeader as="h1" title={t("home.title")} description={t("home.subtitle")} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel testId="home-condition">
          <DataState query={strategies} compact>
            {(envelope) => <InsightCard className="border-0 p-0" title={t("home.marketCondition")} description={envelope.data.screenerVersion ?? undefined} observations={screenContextObservations(envelope.data, t, locale)} meta={freshnessMeta(envelope)} />}
          </DataState>
        </Panel>
        <Panel testId="home-indices">
          <SectionHeader as="h3" title={t("home.indices")} meta={market.data ? freshnessMeta(market.data) : undefined} />
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

      <Panel testId="home-strategies">
        <SectionHeader
          as="h2"
          title={t("home.strategies")}
          description={t("home.strategiesHint")}
          meta={strategies.data ? freshnessMeta(strategies.data) : undefined}
          actions={<Link href="/discover/strategies" className="flex items-center gap-1 text-xs text-primary hover:underline" data-testid="home-strategies-all">{t("home.viewAll")}<ChevronRight className="size-3.5" /></Link>}
        />
        <DataState query={strategies} compact isEmpty={(envelope) => envelope.data.strategies.length === 0}>
          {(envelope) => (
            <div className="flex flex-col gap-4">
              {envelope.data.strategies.slice(0, 3).map((strategy) => (
                <div key={strategy.id} className="flex flex-col gap-1">
                  <Link href={`/discover/strategies/${strategy.id}`} className="flex items-center justify-between gap-2 text-sm font-medium hover:underline" data-testid={`home-strategy-${strategy.id}`}>
                    {strategy.name}
                    <span className="text-xs font-normal text-muted-foreground">{t("strategy.matches", { count: strategy.matches.length })}</span>
                  </Link>
                  {strategy.matches.slice(0, 5).map((match) => (
                    <StockRow key={match.symbol} symbol={match.symbol} name={match.name} trailing={<span className="hidden sm:block"><CriteriaList criteria={match.criteria} /></span>} />
                  ))}
                </div>
              ))}
              <ResearchDisclaimer />
            </div>
          )}
        </DataState>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel testId="home-movers">
          <SectionHeader as="h3" title={t("home.movers")} meta={market.data ? freshnessMeta(market.data) : undefined} />
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
        <Panel testId="home-sectors">
          <SectionHeader as="h3" title={t("home.sectors")} />
          {/* No Phase 1 source provides per-sector performance; say so rather than invent it. */}
          <EmptyState compact icon={<BarChart3 />} title={t("home.sectorsUnavailable")} />
        </Panel>
        <Panel testId="home-watchlist">
          <SectionHeader as="h3" title={t("home.watchlist")} />
          <WatchlistActivity viewer={viewer} />
        </Panel>
      </div>

      <Panel testId="home-news">
        <SectionHeader as="h2" title={t("home.news")} meta={news.data ? freshnessMeta(news.data) : undefined} />
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
  const items = useQuery({
    queryKey: queryKeys.watchlist(viewer.kind === "user" ? viewer.id : "none"),
    enabled: viewer.kind === "user",
    queryFn: async () => {
      const { data, error } = await createClient().from("watchlist_items").select("id, symbol, position").order("position").limit(10);
      if (error) throw error;
      return data;
    },
  });
  if (viewer.kind !== "user") return <EmptyState compact icon={<LogIn />} title={t("watchlistSignIn")} />;
  if (items.isPending) return null;
  if (items.isError || !items.data.length) return <EmptyState compact icon={<Bookmark />} title={t("watchlistEmpty")} />;
  // TODO(next slice): per-symbol quotes for watchlist rows (needs a batched quote endpoint).
  return (
    <div className="flex flex-col">
      {items.data.map((item) => <StockRow key={item.id} symbol={item.symbol} />)}
    </div>
  );
}
