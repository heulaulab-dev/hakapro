"use client";

import { useMemo, useState } from "react";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { SectionHeader } from "@/components/layout/section-header";
import { Link } from "@/i18n/navigation";
import { RrgChart, type RrgChartSeries } from "@/components/charts/rrg-chart";
import { Segmented } from "@/components/kit/segmented";
import { stockHref } from "@/components/layout/nav-config";
import { useStockSectorRotation } from "@/lib/api/hooks";
import type { StockSectorRotation } from "@/lib/api/market";
import { formatDate, type Locale } from "@/lib/format";
import { freshnessMeta } from "@/lib/freshness";
import { useLocale, useTranslations } from "next-intl";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { cn } from "@/lib/utils";

const INTERVALS = ["daily", "weekly"] as const;
const TAILS = [4, 8, 12] as const;
const QUADRANT_ORDER: Record<NonNullable<StockSectorRotation["stocks"][number]["latest"]>["quadrant"], number> = {
  leading: 0, improving: 1, weakening: 2, lagging: 3,
};
const QUADRANT_STYLE = {
  leading: "text-(--positive)", improving: "text-(--series-2)", weakening: "text-(--warning, var(--muted-foreground))", lagging: "text-(--negative)",
};

export function StockSectorRotationView() {
  const [sector, setSector] = useState("");
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]>("weekly");
  const [tail, setTail] = useState<(typeof TAILS)[number]>(8);
  const query = useStockSectorRotation(sector || "all", interval);

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="stock-sector-rotation">
      <DataState query={query}>
        {(envelope) => <Workspace data={envelope.data} meta={freshnessMeta(envelope)} sector={sector} interval={interval} tail={tail}
          onSector={setSector} onInterval={setInterval} onTail={setTail} />}
      </DataState>
      <Methodology />
    </div>
  );
}

function Workspace({ data, meta, sector, interval, tail, onSector, onInterval, onTail }: {
  data: StockSectorRotation;
  meta: ReturnType<typeof freshnessMeta>;
  sector: string;
  interval: (typeof INTERVALS)[number];
  tail: (typeof TAILS)[number];
  onSector: (value: string) => void;
  onInterval: (value: (typeof INTERVALS)[number]) => void;
  onTail: (value: (typeof TAILS)[number]) => void;
}) {
  const t = useTranslations("stockSectorRotation");
  const locale = useLocale() as Locale;
  const [highlight, setHighlight] = useState<string | null>(null);
  const sectorExists = data.sectors.some((entry) => entry.name.toLocaleLowerCase() === sector.toLocaleLowerCase());
  const sortedStocks = useMemo(() => [...data.stocks].sort((a, b) => {
    if (a.latest === null && b.latest !== null) return 1;
    if (a.latest !== null && b.latest === null) return -1;
    if (a.latest && b.latest) return QUADRANT_ORDER[a.latest.quadrant] - QUADRANT_ORDER[b.latest.quadrant] || b.latest.rsRatio - a.latest.rsRatio || a.symbol.localeCompare(b.symbol);
    return a.symbol.localeCompare(b.symbol);
  }), [data.stocks]);
  const chartSeries = useMemo<RrgChartSeries[]>(() => data.stocks
    .filter((stock) => stock.points.length > 0)
    .map((stock, index) => ({ code: stock.symbol, name: stock.name, colorIndex: index, tail: stock.points.slice(-tail) })), [data.stocks, tail]);

  return (
    <>
      <SectionHeader as="h1" title={t("title")} description={t("intro")} meta={meta}
        actions={<div className="flex flex-wrap items-end gap-2" data-testid="stock-sector-rotation-controls">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">{t("sector")}
            <Select value={sectorExists ? sector : data.sector || undefined} onValueChange={onSector}>
              <SelectTrigger className="h-8 min-w-40 text-sm" data-testid="stock-sector-select"><SelectValue placeholder={t("sector")} /></SelectTrigger>
              <SelectContent>{data.sectors.map((entry) => <SelectItem key={entry.name} value={entry.name}>{entry.name} · {entry.members}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground" data-testid="stock-sector-tail"><span>{t("tail")}</span>
            <Segmented value={String(tail)} onChange={(value) => onTail(Number(value) as (typeof TAILS)[number])} options={TAILS.map((value) => ({ value: String(value), label: String(value) }))} />
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground"><span>{t("interval")}</span>
            <Segmented value={interval} onChange={(value) => onInterval(value as (typeof INTERVALS)[number])} options={INTERVALS.map((value) => ({ value, label: t(value) }))} />
          </div>
        </div>} />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="stock-sector-rotation-coverage">
        {data.to && <span>{t("asOf", { date: formatDate(data.to, locale) })}</span>}
        <span>{t("coverage", { count: data.universe.activeMembers, eligible: data.universe.eligibleIssuers, shown: data.universe.returnedIssuers })}</span>
        <span>{t("required", { count: data.requiredObservations })}</span>
        {data.universe.truncated && <span className="text-(--tag-amber-text)">{t("universeCapped")}</span>}
      </div>
      <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3 md:p-4" data-testid="stock-sector-rotation-chart">
        <SectionHeader as="h2" title={t("chartTitle")} description={t("chartDescription")} />
        {chartSeries.length ? <RrgChart series={chartSeries} highlight={highlight} height={460} labelMode="highlight" /> : <EmptyState compact title={t("noPoints")} description={t("required", { count: data.requiredObservations })} />}
      </section>
      <section className="flex flex-col gap-2" data-testid="stock-sector-rotation-rankings">
        <SectionHeader as="h2" title={t("rankings")} />
        {sortedStocks.length ? <Table>
          <caption className="sr-only">{t("rankings")}</caption>
          <TableHeader><TableRow><TableHead>{t("issuer")}</TableHead><TableHead className="text-right">{t("rsRatio")}</TableHead><TableHead className="text-right">{t("rsMomentum")}</TableHead><TableHead>{t("quadrant")}</TableHead><TableHead className="text-right">{t("aligned")}</TableHead></TableRow></TableHeader>
          <TableBody>{sortedStocks.map((stock) => <TableRow key={stock.symbol} onMouseEnter={() => setHighlight(stock.symbol)} onMouseLeave={() => setHighlight(null)} onFocus={() => setHighlight(stock.symbol)} onBlur={() => setHighlight(null)} data-testid={`stock-sector-row-${stock.symbol}`}>
            <TableCell><div className="flex min-w-36 flex-col"><Link href={stockHref(stock.symbol)} className="ticker font-semibold text-link hover:underline">{stock.symbol}</Link><span className="truncate text-xs text-muted-foreground">{stock.name}</span><span className="text-[11px] text-faint">{t("basketCoverage", { percent: stock.basketCoveragePercent.toFixed(1) })}</span></div></TableCell>
            <TableCell className="num text-right">{stock.latest?.rsRatio.toFixed(2) ?? "—"}</TableCell>
            <TableCell className="num text-right">{stock.latest?.rsMomentum.toFixed(2) ?? "—"}</TableCell>
            <TableCell className={cn("font-medium", stock.latest ? QUADRANT_STYLE[stock.latest.quadrant] : "text-muted-foreground")}>{stock.latest ? t(`quadrants.${stock.latest.quadrant}`) : "—"}</TableCell>
            <TableCell className="num text-right">{stock.alignedObservations}</TableCell>
          </TableRow>)}</TableBody>
        </Table> : <EmptyState compact title={t("noPoints")} />}
      </section>
    </>
  );
}

function Methodology() {
  const t = useTranslations("stockSectorRotation");
  return <Accordion type="single" collapsible className="rounded-xl border border-border bg-card px-3" data-testid="stock-sector-rotation-methodology">
    <AccordionItem value="methodology">
      <AccordionTrigger>{t("methodTitle")}</AccordionTrigger>
      <AccordionContent><div className="flex flex-col gap-2 text-sm text-muted-foreground"><p>{t("methodBody")}</p><p>{t("liquidityRule")}</p></div></AccordionContent>
    </AccordionItem>
  </Accordion>;
}
