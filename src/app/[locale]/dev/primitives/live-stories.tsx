"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { Info } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { ChartRangeToggle, useChartRange } from "@/components/charts/chart-range-toggle";
import { DivergingBarChart } from "@/components/charts/diverging-bar-chart";
import { PriceChart } from "@/components/charts/price-chart";
import { DataTable } from "@/components/data/data-table";
import { ScreenerTable } from "@/components/data/screener-table";
import { StockRow } from "@/components/data/stock-row";
import { DataState } from "@/components/feedback/data-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Drawer } from "@/components/layout/drawer";
import { FilterBar, FilterChips, FilterSearch } from "@/components/layout/filter-bar";
import { SectionHeader } from "@/components/layout/section-header";
import { UrlTabs } from "@/components/layout/url-tabs";
import { ChartCard } from "@/components/market/chart-card";
import { InsightCard } from "@/components/market/insight-card";
import { MetricCard } from "@/components/market/metric-card";
import { StockHeader } from "@/components/market/stock-header";
import { Button } from "@/components/ui/button";
import { useBrokerSummary, useHistory, useInsiders, useMarketCap, useStrategies } from "@/lib/api/hooks";
import type { BrokerRow, HistoryRow, InsiderRow, MarketCapRow } from "@/lib/api/market";
import { sliceByRange } from "@/lib/charts/range";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatPercent, formatValue, formatVolume, type Locale } from "@/lib/format";

const SYMBOL = "BBCA";

export function LiveStories() {
  const t = useTranslations();
  return (
    <section className="flex flex-col gap-section">
      <SectionHeader as="h2" title={t("dev.liveTitle")} description={t("dev.liveIntro")} />
      <HistoryStories />
      <div className="grid gap-4 xl:grid-cols-2">
        <BrokerStory />
        <StrategyInsight />
      </div>
      <StrategyStory />
      <UrlTabs
        label={t("dev.tabsLabel")}
        tabs={[
          { value: "marketcap", label: t("dev.marketCapList"), content: <MarketCapStory /> },
          { value: "insiders", label: t("insiders.title"), content: <InsidersStory /> },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">{t("dev.statusTones")}</h3>
          <div className="flex flex-wrap gap-2">
            <StatusBadge tone="positive">{t("chart.netBuy")}</StatusBadge>
            <StatusBadge tone="negative">{t("chart.netSell")}</StatusBadge>
            <StatusBadge tone="warning">{t("freshness.states.STALE.label")}</StatusBadge>
            <StatusBadge tone="info">{t("criteria.foreignBuying")}</StatusBadge>
            <StatusBadge tone="neutral" icon={<Info />}>{t("criteria.unrecognized")}</StatusBadge>
          </div>
          <p className="text-xs text-muted-foreground">{t("dev.paletteNote")}</p>
        </div>
        <NotRecordedStory />
      </div>
    </section>
  );
}

function HistoryStories() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const query = useHistory(SYMBOL, { frame: "daily", limit: 250 });
  const [range, setRange] = useChartRange();
  const columns = useMemo<ColumnDef<HistoryRow, unknown>[]>(() => [
    { accessorKey: "date", header: t("chart.date"), cell: ({ getValue }) => <span className="num">{formatDate(getValue<string>(), locale)}</span> },
    { accessorKey: "open", header: t("chart.open"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale) },
    { accessorKey: "high", header: t("chart.high"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale) },
    { accessorKey: "low", header: t("chart.low"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale) },
    { accessorKey: "close", header: t("chart.close"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale) },
    { accessorKey: "changePercent", header: t("metrics.change"), meta: { numeric: true }, cell: ({ getValue }) => formatPercent(getValue<number>(), locale) },
    { accessorKey: "volumeShares", header: t("chart.volume"), meta: { numeric: true }, cell: ({ getValue }) => formatVolume(getValue<number>(), locale, { compact: true }) },
  ], [t, locale]);

  return (
    <DataState query={query} isEmpty={(envelope) => envelope.data.rows.length === 0}>
      {(envelope) => {
        const meta = freshnessMeta(envelope);
        const rows = envelope.data.rows;
        const latest = rows.at(-1)!;
        const sliced = sliceByRange(rows, range);
        return (
          <div className="flex flex-col gap-4" data-testid="history-stories">
            <StockHeader symbol={SYMBOL} price={latest.close} change={latest.change} changePercent={latest.changePercent} meta={meta} />
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label={t("metrics.lastClose")} value={latest.close} format="idr" changePercent={latest.changePercent} meta={meta} />
              <MetricCard label={t("metrics.value")} value={latest.valueIdr} format="idrCompact" meta={meta} />
              <MetricCard label={t("metrics.volume")} value={latest.volumeShares} format="sharesCompact" hint={formatVolume(latest.volumeShares, locale, { unit: "lots", compact: true })} meta={meta} />
              <MetricCard label={t("metrics.foreignNet")} value={latest.foreignNetShares} format="sharesCompact" meta={meta} />
            </div>
            <ChartCard
              testId="price-chart-card"
              title={t("dev.priceTitle")}
              description={sliced.limited ? t("chart.rangeLimited", { count: rows.length }) : undefined}
              meta={meta}
              actions={<ChartRangeToggle value={range} onChange={(next) => void setRange(next)} />}
              table={<DataTable columns={columns} data={[...sliced.rows].reverse()} meta={meta} caption={t("dev.historyTable")} getRowId={(row) => row.date} maxHeight={360} />}
              footer={t("chart.attribution")}
            >
              <PriceChart rows={sliced.rows} />
            </ChartCard>
          </div>
        );
      }}
    </DataState>
  );
}

function BrokerStory() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const query = useBrokerSummary(SYMBOL);
  const columns = useMemo<ColumnDef<BrokerRow, unknown>[]>(() => [
    { accessorKey: "code", header: t("broker.code"), cell: ({ row }) => <span className="ticker font-medium" title={row.original.name}>{row.original.code}</span> },
    { accessorKey: "netValueIdr", header: t("broker.net"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "buyValueIdr", header: t("broker.buy"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "sellValueIdr", header: t("broker.sell"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "netVolumeShares", header: t("broker.netVolume"), meta: { numeric: true }, cell: ({ getValue }) => formatVolume(getValue<number>(), locale, { compact: true }) },
  ], [t, locale]);
  return (
    <DataState query={query} isEmpty={(envelope) => envelope.data.brokers.length === 0}>
      {(envelope) => {
        const meta = freshnessMeta(envelope);
        const brokers = envelope.data.brokers;
        const extremes = [...brokers.slice(0, 10), ...brokers.slice(-10)].filter((row, index, all) => all.findIndex((other) => other.code === row.code) === index);
        return (
          <ChartCard
            testId="broker-chart-card"
            title={`${t("broker.title")} · ${SYMBOL}`}
            description={t("broker.topNet")}
            meta={meta}
            table={<DataTable columns={columns} data={brokers} meta={meta} caption={t("broker.title")} getRowId={(row) => row.code} maxHeight={360} initialSorting={[{ id: "netValueIdr", desc: true }]} />}
          >
            <DivergingBarChart ariaLabel={t("broker.topNet")} format="idrCompact" data={extremes.map((row) => ({ key: row.code, label: row.code, value: row.netValueIdr }))} />
          </ChartCard>
        );
      }}
    </DataState>
  );
}

function StrategyInsight() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const query = useStrategies();
  return (
    <DataState query={query}>
      {(envelope) => {
        const screen = envelope.data;
        const observations = [
          screen.marketCondition && { id: "condition", tone: "neutral" as const, text: t("strategy.marketCondition", { label: screen.marketCondition.label, avg: formatPercent(screen.marketCondition.averageChangePercent, locale) }) },
          screen.universe && { id: "universe", tone: "neutral" as const, text: t("strategy.universe", { covered: formatValue(screen.universe.covered, "number", locale), liquid: formatValue(screen.universe.liquid, "number", locale), skipped: formatValue(screen.universe.skipped, "number", locale) }) },
          ...screen.strategies.map((strategy) => ({ id: strategy.id, tone: "info" as const, text: `${strategy.name}: ${t("strategy.matches", { count: strategy.matches.length })}` })),
        ].filter((observation): observation is NonNullable<typeof observation> => Boolean(observation));
        return <InsightCard title={t("strategy.insightTitle")} description={screen.screenerVersion ?? undefined} observations={observations} meta={freshnessMeta(envelope)} />;
      }}
    </DataState>
  );
}

function StrategyStory() {
  const t = useTranslations();
  const query = useStrategies();
  return (
    <DataState query={query} isEmpty={(envelope) => envelope.data.strategies.length === 0}>
      {(envelope) => {
        const strategy = envelope.data.strategies[0];
        return (
          <div className="flex flex-col gap-3">
            <SectionHeader title={`${t("strategy.screenTitle")}: ${strategy.name}`} description={strategy.description ?? undefined} />
            <ScreenerTable matches={strategy.matches} meta={freshnessMeta(envelope)} caption={strategy.name} />
          </div>
        );
      }}
    </DataState>
  );
}

function MarketCapStory() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const query = useMarketCap();
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [selected, setSelected] = useState<MarketCapRow | null>(null);
  return (
    <DataState query={query}>
      {(envelope) => {
        const needle = q.trim().toLowerCase();
        const rows = envelope.data.rows.filter((row) => !needle || row.symbol.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle));
        return (
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4" data-testid="marketcap-story">
            <SectionHeader as="h3" title={t("dev.marketCapList")} meta={freshnessMeta(envelope)} />
            <FilterBar active={Boolean(q)} onReset={() => void setQ(null)}>
              <FilterSearch />
            </FilterBar>
            <div className="flex flex-col">
              {rows.map((row) => (
                <StockRow
                  key={row.symbol}
                  symbol={row.symbol}
                  name={row.name}
                  price={row.closeIdr}
                  trailing={
                    <>
                      <span className="ticker w-24 shrink-0 text-right text-muted-foreground">{formatIdr(row.marketCapIdr, locale, { compact: true })}</span>
                      <Button variant="ghost" size="sm" onClick={(event) => { event.preventDefault(); setSelected(row); }} data-testid={`drawer-open-${row.symbol}`}>
                        {t("dev.drawerOpen")}
                      </Button>
                    </>
                  }
                />
              ))}
            </div>
            <Drawer open={selected !== null} onOpenChange={(open) => !open && setSelected(null)} title={selected?.symbol ?? ""} description={selected?.name}>
              {selected && (
                <dl className="grid grid-cols-2 gap-y-2 text-sm">
                  <dt className="text-muted-foreground">{t("metrics.lastClose")}</dt>
                  <dd className="ticker text-right">{formatIdr(selected.closeIdr, locale)}</dd>
                  <dt className="text-muted-foreground">{t("metrics.marketCap")}</dt>
                  <dd className="ticker text-right">{formatIdr(selected.marketCapIdr, locale, { compact: true })}</dd>
                  <dt className="text-muted-foreground">{t("metrics.listedShares")}</dt>
                  <dd className="ticker text-right">{formatVolume(selected.listedShares, locale, { compact: true })}</dd>
                </dl>
              )}
            </Drawer>
          </div>
        );
      }}
    </DataState>
  );
}

function InsidersStory() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const query = useInsiders(SYMBOL);
  const [action] = useQueryState("action", parseAsString);
  const columns = useMemo<ColumnDef<InsiderRow, unknown>[]>(() => [
    { accessorKey: "date", header: t("insiders.date"), cell: ({ getValue }) => <span className="num">{formatDate(getValue<string>(), locale)}</span> },
    { accessorKey: "person", header: t("insiders.person"), cell: ({ row }) => <span className="block max-w-56 truncate" title={row.original.person}>{row.original.person}</span> },
    { accessorKey: "action", header: t("insiders.action"), cell: ({ row }) => <StatusBadge tone={row.original.action === "BUY" ? "positive" : row.original.action === "SELL" ? "negative" : "neutral"}>{t(`insiders.actions.${row.original.action}`)}</StatusBadge> },
    { accessorKey: "changeShares", header: t("insiders.change"), meta: { numeric: true }, cell: ({ getValue }) => formatVolume(getValue<number | null>(), locale) },
    { accessorKey: "currentShares", header: t("insiders.holding"), meta: { numeric: true }, cell: ({ getValue }) => formatVolume(getValue<number | null>(), locale, { compact: true }) },
    { accessorKey: "priceIdr", header: t("insiders.price"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number | null>(), locale) },
  ], [t, locale]);
  return (
    <DataState query={query}>
      {(envelope) => (
        <DataTable
          testId="insiders-table"
          columns={columns}
          data={envelope.data.rows.filter((row) => !action || row.action === action)}
          meta={freshnessMeta(envelope)}
          caption={t("insiders.title")}
          toolbar={<FilterChips param="action" label={t("insiders.action")} options={(["BUY", "SELL"] as const).map((value) => ({ value, label: t(`insiders.actions.${value}`) }))} />}
        />
      )}
    </DataState>
  );
}

function NotRecordedStory() {
  const t = useTranslations("dev");
  const query = useHistory("SOCI");
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4" data-testid="not-recorded-story">
      <h3 className="text-sm font-semibold">{t("notRecordedDemo")}</h3>
      <DataState query={query} compact>{() => null}</DataState>
    </div>
  );
}
