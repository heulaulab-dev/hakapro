"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { StockRow } from "@/components/data/stock-row";
import { DataState } from "@/components/feedback/data-state";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMarketCap, useMarketOverview } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { formatIdr, formatValue, type Locale } from "@/lib/format";
import { MIN_VALUE_IDR, rankMovers, type MoverView } from "@/lib/movers";

const VIEWS = ["gainers", "losers", "active"] as const;

export function MoversView() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [view, setView] = useQueryState("view", parseAsStringLiteral(VIEWS).withDefault("gainers"));
  const market = useMarketOverview();
  const marketCap = useMarketCap();
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="movers-view">
      <SectionHeader as="h1" title={t("movers.title")} description={t("movers.intro")} />
      <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
        <Panel title={t("movers.title")} meta={market.data ? freshnessMeta(market.data) : undefined}>
          <ToggleGroup type="single" size="sm" variant="outline" value={view} onValueChange={(value) => value && void setView(value as MoverView)} aria-label={t("movers.viewLabel")} className="self-start">
            {VIEWS.map((value) => <ToggleGroupItem key={value} value={value} className="px-2.5 text-xs" data-testid={`movers-${value}`}>{t(`movers.${value}`)}</ToggleGroupItem>)}
          </ToggleGroup>
          <DataState query={market} compact isEmpty={(envelope) => envelope.data.movers.length === 0}>
            {(envelope) => (
              <div className="flex flex-col">
                <p className="num pb-1 text-xs text-muted-foreground">{t("home.breadth", { adv: envelope.data.breadth.advancers, dec: envelope.data.breadth.decliners, unch: envelope.data.breadth.unchanged })}</p>
                {rankMovers(envelope.data.movers, view).map((row) => (
                  <StockRow key={row.symbol} symbol={row.symbol} name={row.name} price={row.close} changePercent={view === "active" ? undefined : row.changePercent}
                    trailing={view === "active" ? <span className="ticker w-24 shrink-0 text-right text-muted-foreground">{formatIdr(row.valueIdr, locale, { compact: true })}</span> : undefined} />
                ))}
                {view !== "active" && <p className="pt-2 text-[11px] text-muted-foreground">{t("movers.liquidityNote", { min: formatIdr(MIN_VALUE_IDR, locale, { compact: true }) })}</p>}
              </div>
            )}
          </DataState>
        </Panel>
        <Panel testId="largest-caps" title={t("movers.largest")} meta={marketCap.data ? freshnessMeta(marketCap.data) : undefined}>
          <DataState query={marketCap} compact>
            {(envelope) => (
              <div className="flex flex-col">
                {envelope.data.rows.slice(0, 15).map((row) => (
                  <StockRow key={row.symbol} symbol={row.symbol} name={row.name} trailing={<span className="ticker w-24 shrink-0 text-right">{formatIdr(row.marketCapIdr, locale, { compact: true })}</span>} />
                ))}
                <p className="num pt-2 text-[11px] text-muted-foreground">{formatValue(envelope.data.total, "number", locale)}</p>
              </div>
            )}
          </DataState>
        </Panel>
      </div>
    </div>
  );
}
