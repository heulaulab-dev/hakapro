"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { DataState } from "@/components/feedback/data-state";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { stockHref } from "@/components/layout/nav-config";
import { Link } from "@/i18n/navigation";
import { useAnalysisCompare } from "@/lib/api/hooks";
import type { StockAnalysis } from "@/lib/api/market";
import { ANALYSIS_BATCH_MAX } from "@/lib/api/provider-limits";
import { macdDirection, position, rsiZone, toneStatus, volumeLevel } from "@/lib/analysis";
import { freshnessMeta } from "@/lib/freshness";
import { formatNumber, formatPercent, formatVolume, type Locale } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Side-by-side analysis for up to five stocks. Each stock costs one provider request, so nothing is
 * fetched until the user presses Compare; a partial result is labelled as such.
 */
export function AnalysisCompare({ symbols }: { symbols: string[] }) {
  const t = useTranslations("analysis.compare");
  const [picked, setPicked] = useState<string[]>([]);
  const [compared, setCompared] = useState<string[]>([]);
  const query = useAnalysisCompare(compared);
  const available = symbols.filter((symbol, index) => symbols.indexOf(symbol) === index);
  const toggle = (symbol: string) => setPicked((current) => current.includes(symbol) ? current.filter((item) => item !== symbol) : current.length >= ANALYSIS_BATCH_MAX ? current : [...current, symbol]);
  return (
    <Panel testId="analysis-compare" title={t("title")} description={t("intro", { max: ANALYSIS_BATCH_MAX })} meta={query.data ? freshnessMeta(query.data) : undefined}
      actions={<Button size="sm" variant="primary" disabled={picked.length === 0} onClick={() => setCompared(picked)} data-testid="compare-run">{t("run", { count: picked.length })}</Button>}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("pick")}>
        {available.map((symbol) => {
          const on = picked.includes(symbol);
          return (
            <button key={symbol} type="button" aria-pressed={on} onClick={() => toggle(symbol)} data-testid={`compare-pick-${symbol}`}
              disabled={!on && picked.length >= ANALYSIS_BATCH_MAX}
              className={cn("ticker rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:opacity-40", on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-accent")}>
              {symbol}
            </button>
          );
        })}
      </div>
      {compared.length > 0 && (
        <DataState query={query} compact>
          {(envelope) => <CompareTable items={envelope.data} />}
        </DataState>
      )}
    </Panel>
  );
}

type Item = { symbol: string } & ({ status: "ok"; data: StockAnalysis } | { status: "error"; error: string });

function CompareTable({ items }: { items: Item[] }) {
  const t = useTranslations("analysis");
  const locale = useLocale() as Locale;
  const ok = (item: Item) => (item.status === "ok" ? item.data : null);
  const rows: Array<{ key: string; label: string; cell: (data: StockAnalysis) => React.ReactNode }> = [
    { key: "score", label: t("score.title"), cell: (d) => d.score ? <span className="flex items-center gap-1.5"><span className="ticker">{d.score.value}/{d.score.max}</span><StatusBadge tone={toneStatus(d.score.tone)}>{t(`tone.${d.score.tone ?? "unknown"}`)}</StatusBadge></span> : "—" },
    { key: "stance", label: t("outlook.title"), cell: (d) => d.outlook ? t(`outlook.stances.${d.outlook.stance}`) : "—" },
    { key: "change", label: t("price.close"), cell: (d) => formatPercent(d.price.changePercent, locale, { signed: true }) },
    { key: "sma20", label: t("technical.sma", { period: 20 }), cell: (d) => { const p = position(d.price.closeIdr, d.technical.sma.find((s) => s.period === 20)?.valueIdr ?? null); return p ? t(`technical.position.${p}`) : "—"; } },
    { key: "rsi", label: t("technical.rsi"), cell: (d) => { const z = rsiZone(d.technical.rsi14); return `${formatNumber(d.technical.rsi14, locale, { decimals: 0 })}${z ? ` · ${t(`technical.rsiZone.${z}`)}` : ""}`; } },
    { key: "macd", label: t("technical.macd"), cell: (d) => { const m = macdDirection(d.technical.macd?.histogram); return m ? t(`technical.macdDirection.${m}`) : "—"; } },
    { key: "volume", label: t("volume.ratio"), cell: (d) => { const v = volumeLevel(d.volume.ratio); return d.volume.ratio === null ? "—" : `${formatNumber(d.volume.ratio, locale, { decimals: 1 })}×${v ? ` · ${t(`volume.levels.${v}`)}` : ""}`; } },
    { key: "foreign", label: t("foreign.net"), cell: (d) => formatVolume(d.foreign.netShares, locale, { compact: true, signed: true }) },
    { key: "brokers", label: t("brokers.heavy"), cell: (d) => t("brokers.heavyCounts", { buyers: d.brokers.heavyBuyers.length, sellers: d.brokers.heavySellers.length }) },
    { key: "patterns", label: t("patterns.best"), cell: (d) => { const best = [...d.patterns].sort((a, b) => (b.winRatePercent ?? 0) - (a.winRatePercent ?? 0))[0]; return best ? t("patterns.bestValue", { rate: formatPercent(best.winRatePercent, locale, { decimals: 1, signed: false }), samples: best.samples ?? 0 }) : "—"; } },
  ];
  const failed = items.filter((item) => item.status === "error");
  return (
    <div className="flex flex-col gap-2">
      {failed.length > 0 && <p role="status" className="text-xs text-warning" data-testid="compare-partial">{t("compare.partial", { list: failed.map((item) => `${item.symbol} (${item.status === "error" ? item.error : ""})`).join(", ") })}</p>}
      <div className="overflow-x-auto">
        <Table className="min-w-[32rem]" data-testid="compare-table">
          <TableHeader>
            <TableRow interactive={false}>
              <TableHead className="h-auto px-(--spacing-cell-x) py-cell-y text-xs font-medium whitespace-normal text-muted-foreground" />
              {items.map((item) => <TableHead key={item.symbol} className="h-auto px-(--spacing-cell-x) py-cell-y text-xs font-medium whitespace-normal text-muted-foreground"><Link href={stockHref(item.symbol, "analysis")} className="ticker text-foreground hover:underline">{item.symbol}</Link></TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key} className="h-row">
                <TableHead scope="row" className="h-auto px-(--spacing-cell-x) py-cell-y text-xs whitespace-normal text-muted-foreground">{row.label}</TableHead>
                {items.map((item) => { const data = ok(item); return <TableCell key={item.symbol} className="px-(--spacing-cell-x)">{data ? row.cell(data) : <span className="text-muted-foreground">—</span>}</TableCell>; })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
