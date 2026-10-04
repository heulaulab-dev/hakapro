"use client";

import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { StockRow } from "@/components/data/stock-row";
import { DataState } from "@/components/feedback/data-state";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMarketCap, useMarketOverview } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatValue, type Locale } from "@/lib/format";
import { MIN_VALUE_IDR, rankMovers, type MoverView } from "@/lib/movers";

const VIEWS = ["gainers", "losers", "active"] as const;
const CAPS_PER_PAGE = 25;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function MoversView() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const [view, setView] = useQueryState("view", parseAsStringLiteral(VIEWS).withDefault("gainers"));
  const market = useMarketOverview();
  const [capPage, setCapPage] = useQueryState("cpage", parseAsInteger.withDefault(1));
  const [capDate, setCapDate] = useQueryState("cdate", parseAsString);
  const marketCap = useMarketCap({ page: capPage, perPage: CAPS_PER_PAGE, date: capDate ?? undefined });
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
        <Panel testId="largest-caps" title={t("movers.largest")} meta={marketCap.data ? freshnessMeta(marketCap.data) : undefined}
          actions={
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="sr-only">{t("movers.capDate")}</span>
              <Input type="date" value={capDate ?? ""} onChange={(event) => { const value = event.target.value; void setCapDate(ISO_DATE.test(value) ? value : null); void setCapPage(null); }} className="h-8 w-36 text-xs" data-testid="caps-date" />
            </label>
          }>
          <DataState query={marketCap} compact>
            {(envelope) => {
              const data = envelope.data;
              return (
                <div className="flex flex-col">
                  <p className="pb-1 text-[11px] text-muted-foreground">{t("movers.capsAsOf", { date: formatDate(data.date, locale), total: formatValue(data.total, "number", locale) })}</p>
                  {data.rows.map((row, index) => (
                    <StockRow key={row.symbol} symbol={row.symbol} name={row.name}
                      trailing={<span className="ticker w-24 shrink-0 text-right">{formatIdr(row.marketCapIdr, locale, { compact: true })}</span>}
                      rank={(data.page - 1) * data.perPage + index + 1} />
                  ))}
                  <div className="flex items-center justify-end gap-2 pt-2 text-xs text-muted-foreground">
                    <span className="num" data-testid="caps-page">{t("stockInsiders.page", { page: data.page, total: Math.max(1, data.totalPages) })}</span>
                    <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => void setCapPage(data.page - 1 > 1 ? data.page - 1 : null)}>{t("stockInsiders.previous")}</Button>
                    <Button variant="outline" size="sm" disabled={data.page >= data.totalPages} onClick={() => void setCapPage(data.page + 1)} data-testid="caps-next">{t("stockInsiders.next")}</Button>
                  </div>
                </div>
              );
            }}
          </DataState>
        </Panel>
      </div>
    </div>
  );
}
