"use client";

import { Activity } from "@/components/kit/icons";
import { useLocale, useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { StockRow } from "@/components/data/stock-row";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { SectionHeader } from "@/components/layout/section-header";
import { CounterChip, SignalChip } from "@/components/radar/radar-chips";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Link } from "@/i18n/navigation";
import { useRadar } from "@/lib/api/hooks";
import type { Radar, RadarStock } from "@/lib/api/market";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, type Locale } from "@/lib/format";
import type { RadarSignalKey } from "@/lib/radar/rules";

const categories = ["all", "volume", "price", "flow"] as const;
type Category = (typeof categories)[number];

const signalCategory: Partial<Record<RadarSignalKey, Exclude<Category, "all">>> = {
  volumeSpike: "volume",
  orderSizeSpike: "volume",
  closeAboveAverage: "price",
  priceUp5: "price",
  foreignNetBuy5: "flow",
  foreignNetBuy20: "flow",
};

function signalsFor(stock: RadarStock, category: Category) {
  return stock.fired.filter((signal) => signalCategory[signal.key] && (category === "all" || signalCategory[signal.key] === category));
}

export function DailyFeedView() {
  const t = useTranslations("dailyFeed");
  const query = useRadar();
  return <div className="flex flex-col gap-section p-4 md:p-6" data-testid="daily-feed-view">
    <SectionHeader as="h1" title={t("title")} description={t("intro")} meta={query.data ? freshnessMeta(query.data) : undefined} />
    <DataState query={query}>{(envelope) => <FeedBody radar={envelope.data} />}</DataState>
    <ResearchDisclaimer />
  </div>;
}

function FeedBody({ radar }: { radar: Radar }) {
  const t = useTranslations("dailyFeed");
  const locale = useLocale() as Locale;
  const [view, setView] = useQueryState("view", parseAsString.withDefault("all"));
  const category: Category = categories.includes(view as Category) ? view as Category : "all";
  if (!radar.tradingDate) return <EmptyState icon={<Activity />} title={t("noSession")} />;

  const shown = radar.stocks.filter((stock) => signalsFor(stock, category).length > 0);
  return <section className="flex flex-col gap-4">
    <div className="space-y-1 rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
      <p className="font-medium num" data-testid="daily-feed-date">{t("asOf", { date: formatDate(radar.tradingDate, locale) })}</p>
      <p className="caption-style text-subtle">{t("coverage", { stocks: radar.coverage.stocks, listed: radar.coverage.listed, returned: radar.coverage.returned })}</p>
      <p className="caption-style text-subtle">{t("method", { version: radar.rulesVersion })} <Link href="/discover/radar" className="text-link hover:underline">{t("radarLink")}</Link></p>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <ToggleGroup type="single" size="sm" variant="outline" value={category} onValueChange={(value) => { if (value) void setView(value === "all" ? null : value); }} aria-label={t("filterLabel")}>
        {categories.map((value) => <ToggleGroupItem key={value} value={value}>{t(`filters.${value}`)}</ToggleGroupItem>)}
      </ToggleGroup>
      <span className="caption-style text-subtle">{t("shown", { count: shown.length })}</span>
    </div>
    {shown.length === 0 ? <EmptyState compact icon={<Activity />} title={t("empty")} /> :
      <ol className="flex flex-col divide-y divide-border rounded-xl border border-border" data-testid="daily-feed-list">
        {shown.map((stock, index) => <li key={stock.symbol} className="flex flex-col gap-2 px-2 py-2" data-testid={`daily-feed-${stock.symbol}`}>
          <StockRow symbol={stock.symbol} rank={index + 1} name={stock.name} price={stock.close} changePercent={stock.changePercent} />
          <div className="flex flex-wrap gap-1.5 px-cell-x" aria-label={t("observations")}>
            {signalsFor(stock, category).map((signal) => <SignalChip key={signal.key} item={signal} rules={radar.rules} />)}
          </div>
          {stock.counter.some((item) => item.key !== "kseiHolderDecrease") && <div className="flex flex-wrap gap-1.5 px-cell-x" aria-label={t("counterEvidence")}>
            {stock.counter.filter((item) => item.key !== "kseiHolderDecrease").map((item) => <CounterChip key={item.key} item={item} />)}
          </div>}
        </li>)}
      </ol>}
  </section>;
}
