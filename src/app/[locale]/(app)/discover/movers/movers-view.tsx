"use client";

import { parseAsInteger, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { DataState } from "@/components/feedback/data-state";
import { stockHref } from "@/components/layout/nav-config";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { ChangeValue } from "@/components/market/change-value";
import { Button } from "@/components/ui/button";
import { DatePicker, toIsoDate } from "@/components/ui/date-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TickerLogo } from "@/components/market/ticker-logo";
import { Link } from "@/i18n/navigation";
import { useMarketCap, useMarketOverview, useSectors } from "@/lib/api/hooks";
import { barPercent, intensityTier, maxOf, proportions } from "@/lib/bars";
import { freshnessMeta } from "@/lib/freshness";
import { direction, formatDate, formatIdr, formatValue, type Locale } from "@/lib/format";
import { MIN_VALUE_IDR, rankMovers, type MoverView } from "@/lib/movers";
import { cn } from "@/lib/utils";

const VIEWS = ["gainers", "losers", "active"] as const;
const CAPS_PER_PAGE = 25;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Subtle row tint by size of the move; direction is always also shown by arrow and sign. */
const TINT = {
  positive: ["", "bg-positive/[0.03]", "bg-positive/[0.06]", "bg-positive/10"],
  negative: ["", "bg-negative/[0.03]", "bg-negative/[0.06]", "bg-negative/10"],
  neutral: ["", "", "", ""],
} as const;

const pill = { positive: "bg-positive-muted", negative: "bg-negative-muted", neutral: "bg-secondary" } as const;

/** Horizontal magnitude bar on a quiet track; the label stays in text. */
function Bar({ percent, className }: { percent: number; className?: string }) {
  return (
    <span aria-hidden className={cn("block h-1.5 overflow-hidden rounded-full bg-track", className)}>
      <span className="block h-full rounded-full bg-foreground/40" style={{ width: `${percent}%` }} />
    </span>
  );
}

/** Advancers / unchanged / decliners as one proportion strip with counted labels. */
function BreadthBar({ adv, unch, dec }: { adv: number | null; unch: number | null; dec: number | null }) {
  const t = useTranslations("movers");
  const parts = [adv ?? 0, unch ?? 0, dec ?? 0];
  const [pAdv, pUnch, pDec] = proportions(parts);
  const total = parts.reduce((a, b) => a + b, 0);
  const label = t("breadthLabel", { adv: parts[0], dec: parts[2], unch: parts[1] });
  return (
    <div className="flex flex-col gap-2" data-testid="breadth">
      <div className="flex items-center justify-between gap-2">
        <h3 className="eyebrow-style font-normal text-soft">{t("breadthTitle")}</h3>
        <span className="sr-only">{label}</span>
      </div>
      {total > 0 ? (
        <div role="img" aria-label={label} className="flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {pAdv > 0 && <span className="rounded-l-full bg-positive" style={{ width: `${pAdv}%` }} />}
          {pUnch > 0 && <span className="bg-muted-foreground/50" style={{ width: `${pUnch}%` }} />}
          {pDec > 0 && <span className="rounded-r-full bg-negative" style={{ width: `${pDec}%` }} />}
        </div>
      ) : <Skeleton className="h-2.5 w-full" />}
      <dl className="num grid grid-cols-3 text-xs">
        <div className="flex flex-col"><dt className="text-muted-foreground">▲ {t("advancers")}</dt><dd className="text-sm font-medium text-positive">{adv ?? "—"}</dd></div>
        <div className="flex flex-col items-center"><dt className="text-muted-foreground">= {t("unchanged")}</dt><dd className="text-sm font-medium">{unch ?? "—"}</dd></div>
        <div className="flex flex-col items-end"><dt className="text-muted-foreground">▼ {t("decliners")}</dt><dd className="text-sm font-medium text-negative">{dec ?? "—"}</dd></div>
      </dl>
    </div>
  );
}

const MOVER_GRID = "grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[2rem_minmax(0,1.3fr)_6.5rem_6.5rem_minmax(7rem,1fr)]";

function MoverRow({ rank, symbol, name, price, changePercent, valueIdr, maxValue }: {
  rank: number; symbol: string; name: string | null; price: number | null; changePercent: number | null; valueIdr: number | null; maxValue: number;
}) {
  const locale = useLocale() as Locale;
  const dir = direction(changePercent);
  return (
    <li>
      <Link href={stockHref(symbol)} data-testid={`stock-row-${symbol}`}
        className={cn(MOVER_GRID, "min-h-14 rounded-lg px-2 py-2 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60", TINT[dir][intensityTier(changePercent)])}>
        <span className="num row-span-2 self-center text-right text-xs text-muted-foreground sm:row-span-1">{rank}</span>
        <span className="flex min-w-0 flex-col">
          <span className="flex items-center gap-2"><TickerLogo symbol={symbol} size="sm" /><span className="ticker font-medium">{symbol}</span></span>
          <span className="truncate pl-7 text-xs text-muted-foreground">{name}</span>
        </span>
        <span className="ticker col-start-2 row-start-2 text-sm sm:col-start-auto sm:row-start-auto sm:text-right">{formatIdr(price, locale)}</span>
        <span className="col-start-3 row-start-1 justify-self-end sm:col-start-auto sm:row-start-auto">
          <ChangeValue percent={changePercent} className={cn("justify-end rounded-full px-2.5 py-1 text-sm font-medium", pill[dir])} />
        </span>
        <span className="col-start-3 row-start-2 flex flex-col items-end gap-1 sm:col-start-auto sm:row-start-auto">
          <span className="ticker text-xs text-muted-foreground">{formatIdr(valueIdr, locale, { compact: true })}</span>
          <Bar percent={barPercent(valueIdr, maxValue)} className="w-full max-w-28 sm:max-w-none" />
        </span>
      </Link>
    </li>
  );
}


function MoversList({ view }: { view: MoverView }) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const market = useMarketOverview();
  return (
    <DataState query={market} compact skeleton={<MoverSkeleton />} isEmpty={(envelope) => envelope.data.movers.length === 0}>
      {(envelope) => {
        const rows = rankMovers(envelope.data.movers, view);
        const maxValue = maxOf(rows.map((row) => row.valueIdr));
        return (
          <div className="flex flex-col gap-1">
            <div role="presentation" className={cn(MOVER_GRID, "sticky top-0 z-10 hidden border-b border-border bg-background/95 px-2 py-2 text-[11px] uppercase tracking-wide text-muted-foreground backdrop-blur sm:grid")}>
              <span className="text-right">#</span><span>{t("movers.rank")}</span><span className="text-right">{t("movers.price")}</span><span className="text-right">{t("movers.change")}</span><span className="text-right">{t("movers.value")}</span>
            </div>
            <ul className="flex flex-col" data-testid="movers-list">
              {rows.map((row, index) => <MoverRow key={row.symbol} rank={index + 1} symbol={row.symbol} name={row.name} price={row.close} changePercent={row.changePercent} valueIdr={row.valueIdr} maxValue={maxValue} />)}
            </ul>
            <p className="pt-2 text-[11px] text-muted-foreground">{t("movers.valueBarHint")}{view !== "active" && ` ${t("movers.liquidityNote", { min: formatIdr(MIN_VALUE_IDR, locale, { compact: true }) })}`}</p>
          </div>
        );
      }}
    </DataState>
  );
}

function MoverSkeleton() {
  return <div className="flex flex-col gap-2" aria-hidden>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
}

/** Sector strip from the Data Engine; renders nothing unless the data is there (it is a shortcut, not a section). */
function SectorStrip() {
  const t = useTranslations("movers");
  const locale = useLocale() as Locale;
  const query = useSectors();
  const sectors = query.data?.data;
  if (!sectors || sectors.length === 0) return null;
  const sorted = [...sectors].filter((s) => s.changePercent !== null).sort((a, b) => b.changePercent - a.changePercent);
  return (
    <nav aria-label={t("sectorsTitle")} className="flex flex-col gap-2" data-testid="sector-strip">
      <div className="flex items-center justify-between gap-2">
        <h2 className="eyebrow-style font-normal text-soft">{t("sectorsTitle")}</h2>
        <Link href="/discover/heatmap" className="inline-flex min-h-10 items-center text-xs text-link hover:underline md:min-h-0">{t("sectorsMore")}</Link>
      </div>
      <ul className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
        {sorted.map((sector) => (
          <li key={sector.sector} className="shrink-0">
            <Link href="/discover/heatmap" title={t("sectorStocks", { count: sector.stocks })} className="flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60">
              <span className="whitespace-nowrap">{sector.sector}</span>
              <ChangeValue percent={sector.changePercent} className="font-medium" />
              <span className="sr-only">{formatValue(sector.stocks, "number", locale)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

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
      <SectorStrip />
      <div className="grid gap-4 xl:grid-cols-[1fr_26rem]">
        <Panel title={t("movers.title")} meta={market.data ? freshnessMeta(market.data) : undefined}>
          {market.data && <BreadthBar adv={market.data.data.breadth.advancers} unch={market.data.data.breadth.unchanged} dec={market.data.data.breadth.decliners} />}
          <ToggleGroup type="single" size="sm" variant="outline" value={view} onValueChange={(value) => value && void setView(value as MoverView)} aria-label={t("movers.viewLabel")} className="grid w-full grid-cols-3 gap-1 rounded-full bg-secondary p-1 sm:inline-grid sm:w-auto sm:self-start">
            {VIEWS.map((value) => <ToggleGroupItem key={value} value={value} className="min-h-10 rounded-full border-0 px-3 text-xs data-[state=on]:bg-background data-[state=on]:shadow-(--shadow-active) sm:min-h-8" data-testid={`movers-${value}`}>{t(`movers.${value}`)}</ToggleGroupItem>)}
          </ToggleGroup>
          <MoversList view={view} />
        </Panel>
        <Panel testId="largest-caps" title={t("movers.largest")} meta={marketCap.data ? freshnessMeta(marketCap.data) : undefined}
          actions={
            <DatePicker
              value={capDate}
              max={toIsoDate(new Date())}
              clearable
              placeholder={t("movers.capDateLatest")}
              aria-label={t("movers.capDate")}
              onChange={(value) => { void setCapDate(value && ISO_DATE.test(value) ? value : null); void setCapPage(null); }}
              className="w-40 [&>button:first-child]:h-8 [&>button:first-child]:text-xs"
              data-testid="caps-date"
            />
          }>
          <DataState query={marketCap} compact skeleton={<MoverSkeleton />}>
            {(envelope) => {
              const data = envelope.data;
              const maxCap = maxOf(data.rows.map((row) => row.marketCapIdr));
              return (
                <div className="flex flex-col">
                  <p className="pb-1 text-[11px] text-muted-foreground">{t("movers.capsAsOf", { date: formatDate(data.date, locale), total: formatValue(data.total, "number", locale) })}</p>
                  <ul className="flex flex-col">
                    {data.rows.map((row, index) => (
                      <li key={row.symbol}>
                        <Link href={stockHref(row.symbol)} data-testid={`stock-row-${row.symbol}`} className="grid min-h-12 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/60">
                          <span className="num row-span-2 text-right text-xs text-muted-foreground">{(data.page - 1) * data.perPage + index + 1}</span>
                          <span className="flex min-w-0 items-center gap-2"><TickerLogo symbol={row.symbol} size="sm" /><span className="ticker font-medium">{row.symbol}</span><span className="truncate text-xs text-muted-foreground">{row.name}</span></span>
                          <span className="ticker text-sm">{formatIdr(row.marketCapIdr, locale, { compact: true })}</span>
                          <Bar percent={barPercent(row.marketCapIdr, maxCap)} className="col-span-2" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                  <p className="pt-2 text-[11px] text-muted-foreground">{t("movers.capBarHint")}</p>
                  <div className="flex items-center justify-end gap-2 pt-2 text-xs text-muted-foreground">
                    <span className="num" data-testid="caps-page">{t("stockInsiders.page", { page: data.page, total: Math.max(1, data.totalPages) })}</span>
                    <Button variant="outline" size="sm" className="min-h-10 md:min-h-0" disabled={data.page <= 1} onClick={() => void setCapPage(data.page - 1 > 1 ? data.page - 1 : null)}>{t("stockInsiders.previous")}</Button>
                    <Button variant="outline" size="sm" className="min-h-10 md:min-h-0" disabled={data.page >= data.totalPages} onClick={() => void setCapPage(data.page + 1)} data-testid="caps-next">{t("stockInsiders.next")}</Button>
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
