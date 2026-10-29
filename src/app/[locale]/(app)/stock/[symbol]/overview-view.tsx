"use client";

import { ChevronRight } from "@/components/kit/icons";
import { useLocale, useTranslations } from "next-intl";
import { ChartRangeToggle, useChartRange } from "@/components/charts/chart-range-toggle";
import { PriceChart } from "@/components/charts/lazy";
import { DataState } from "@/components/feedback/data-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { SectionHeader } from "@/components/layout/section-header";
import { STOCK_TABS, stockHref } from "@/components/layout/nav-config";
import { ChartCard } from "@/components/market/chart-card";
import { MetricCard } from "@/components/market/metric-card";
import { Panel } from "@/components/layout/panel";
import { SectionInsight } from "@/components/market/section-insight";
import { OVERVIEW_HISTORY } from "@/components/market/stock-header-live";
import { Link } from "@/i18n/navigation";
import { useCatalysts, useHistory, useMarketCap, useStockOverview } from "@/lib/api/hooks";
import { sliceByRange } from "@/lib/charts/range";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatPercent, formatVolume, type Locale } from "@/lib/format";

/** "What should I know about this stock?" — before the deep-dive tabs. */
export function OverviewView({ symbol }: { symbol: string }) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const history = useHistory(symbol, OVERVIEW_HISTORY);
  const overview = useStockOverview(symbol);
  const catalysts = useCatalysts(symbol);
  const valuation = useMarketCap({ symbols: [symbol] });
  const [range, setRange] = useChartRange();
  const idr = (value: number | null) => formatIdr(value, locale);
  const shares = (value: number | null) => formatVolume(value, locale, { compact: true });

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="stock-overview">
      <DataState query={history} compact isEmpty={(envelope) => envelope.data.rows.length === 0}>
        {(envelope) => {
          const meta = freshnessMeta(envelope);
          const rows = envelope.data.rows;
          const latest = rows.at(-1)!;
          const sliced = sliceByRange(rows, range);
          return (
            <>
              <section className="flex flex-col gap-3">
                <SectionHeader title={t("overview.keyMetrics")} />
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MetricCard label={t("metrics.lastClose")} value={latest.close} format="idr" changePercent={latest.changePercent} meta={meta} />
                  <MetricCard label={t("metrics.value")} value={latest.valueIdr} format="idrCompact" meta={meta} />
                  <MetricCard label={t("metrics.volume")} value={latest.volumeShares} format="sharesCompact" hint={formatVolume(latest.volumeShares, locale, { unit: "lots", compact: true })} meta={meta} />
                  <MetricCard label={t("metrics.foreignNet")} value={latest.foreignNetShares} format="netSharesCompact" meta={meta} />
                </div>
              </section>
              <ChartCard
                testId="overview-chart"
                title={t("overview.chartTitle")}
                description={sliced.limited ? t("chart.rangeLimited", { count: rows.length }) : undefined}
                meta={meta}
                actions={<ChartRangeToggle value={range} onChange={(next) => void setRange(next)} />}
                footer={t("chart.attribution")}
              >
                <PriceChart rows={sliced.rows} height={280} />
              </ChartCard>
            </>
          );
        }}
      </DataState>

      <DataState query={catalysts} compact>
        {(envelope) => <Panel title={t("overview.catalystsTitle")} description={t("overview.catalystsDescription")} testId="stock-catalysts">
          {envelope.data.events.length === 0 ? <p className="caption-style text-subtle">{t("overview.catalystsEmpty")}</p> : <ul className="flex flex-col divide-y divide-border">{envelope.data.events.slice(0, 6).map((event, index) => <li key={`${event.kind}-${event.occurredAt}-${index}`} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0"><span className="text-sm font-medium">{event.headline}</span><span className="caption-style text-subtle">{event.detail ?? event.source} · {event.occurredAt.slice(0, 10)}</span></li>)}</ul>}
        </Panel>}
      </DataState>

      <DataState query={valuation} compact isEmpty={(envelope) => !envelope.data.rows.some((item) => item.symbol === symbol.toUpperCase())}>
        {(envelope) => {
          const meta = freshnessMeta(envelope);
          const row = envelope.data.rows.find((item) => item.symbol === symbol.toUpperCase())!;
          return (
            <section className="flex flex-col gap-3" data-testid="overview-valuation">
              <SectionHeader title={t("overview.valuation")} description={t("overview.valuationAsOf", { date: formatDate(envelope.data.date, locale) })} />
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                <MetricCard label={t("metrics.marketCap")} value={row.marketCapIdr} format="idrCompact" meta={meta} />
                <MetricCard label={t("metrics.listedShares")} value={row.listedShares} format="sharesCompact" meta={meta} />
                {/* Provider turnover ratio is a fraction of listed shares; shown in percent units. */}
                <MetricCard label={t("metrics.turnover")} value={row.turnoverRatio * 100} format="percentPlain" meta={meta} />
              </div>
            </section>
          );
        }}
      </DataState>

      <DataState query={overview}>
        {(envelope) => {
          const o = envelope.data;
          const sections = [o.price, o.foreignFlow, o.brokers, o.ownership, o.financials];
          const firstError = sections[0].status === "error" ? sections[0].error : null;
          // Same failure everywhere (e.g. an unrecorded symbol): the history block above already says why.
          if (firstError && history.isError && sections.every((item) => item.status === "error" && item.error === firstError)) return null;
          return (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="overview-insights">
              <SectionInsight testId="insight-price" title={t("overview.priceTitle")} section={o.price} observations={(p) => [
                { id: "range", text: t("overview.price.range", { sessions: p.rangeSessions, change: formatPercent(p.rangeChangePercent, locale), low: idr(p.rangeLow), high: idr(p.rangeHigh) }) },
                ...(p.closeVsSma20 && p.sma20 !== null ? [{ id: "sma", text: t(`overview.price.${p.closeVsSma20}`, { sma: idr(p.sma20) }) }] : []),
              ]} />
              <SectionInsight testId="insight-flow" title={t("overview.flowTitle")} section={o.foreignFlow} observations={(f) => [
                { id: "sessions", tone: f.netSellSessions > f.netBuySessions ? "negative" : f.netBuySessions > f.netSellSessions ? "positive" : "neutral", text: t("overview.foreign.sessions", { buy: f.netBuySessions, sell: f.netSellSessions, sessions: f.sessions }) },
                { id: "net", text: t("overview.foreign.net", { sessions: f.sessions, net: shares(f.netShares) }) },
                ...(f.netShares20 !== null ? [{ id: "net20", text: t("overview.foreign.net20", { net: shares(f.netShares20) }) }] : []),
              ]} />
              <SectionInsight testId="insight-brokers" title={t("overview.brokerTitle")} section={o.brokers} observations={(b) => [
                ...(b.topBuyers.length ? [{ id: "buyers", text: t("overview.brokers.topBuyers", { date: formatDate(b.endDate, locale), list: b.topBuyers.map((row) => `${row.code} ${formatIdr(row.netValueIdr, locale, { compact: true })}`).join(", ") }) }] : []),
                b.topSellers.length
                  ? { id: "sellers", text: t("overview.brokers.topSellers", { list: b.topSellers.map((row) => `${row.code} ${formatIdr(row.netValueIdr, locale, { compact: true })}`).join(", ") }) }
                  : { id: "no-sellers", text: t("overview.brokers.noSellers") },
              ]} />
              <SectionInsight testId="insight-ownership" title={t("overview.ownershipTitle")} section={o.ownership} observations={(w) => [
                { id: "summary", text: t("overview.ownership.summary", { count: w.transactions, buys: w.buys, sells: w.sells }) },
                ...(w.netChangeShares !== null ? [{ id: "net", text: t("overview.ownership.net", { net: formatVolume(w.netChangeShares, locale) }) }] : []),
                ...(w.latestDate ? [{ id: "latest", text: t("overview.ownership.latest", { date: formatDate(w.latestDate, locale), total: w.totalReported }) }] : []),
              ]} />
              <SectionInsight testId="insight-financials" title={t("overview.financialTitle")} section={o.financials} observations={(f) => [
                ...(f.latestPeriod && f.latestPeriodEnd ? [{ id: "latest", text: t("overview.financial.latest", { period: f.latestPeriod, end: formatDate(f.latestPeriodEnd, locale) }) }] : []),
                f.behind
                  ? { id: "behind", tone: "warning" as const, text: t("overview.financial.behind", { expected: formatDate(f.expectedPeriodEnd, locale) }) }
                  : { id: "on-time", text: t("overview.financial.onTime") },
                { id: "periods", text: t("overview.financial.periods", { count: f.periods }) },
              ]} />
            </div>
          );
        }}
      </DataState>

      <section className="flex flex-col gap-3">
        <SectionHeader title={t("overview.deepDive")} />
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="deep-dive">
          {STOCK_TABS.filter((tab) => tab !== "overview").map((tab) => (
            <li key={tab}>
              <Link href={stockHref(symbol, tab)} className="group flex items-center justify-between gap-3 rounded-xl border border-border px-4 py-3 transition-colors hover:bg-accent/40">
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{t(`stockTabs.${tab}`)}</span>
                  <span className="text-xs text-muted-foreground">{t(`overview.hints.${tab}`)}</span>
                </span>
                <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <ResearchDisclaimer />
    </div>
  );
}
