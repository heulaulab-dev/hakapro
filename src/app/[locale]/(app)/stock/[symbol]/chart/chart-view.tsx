"use client";

import { parseAsArrayOf, parseAsStringLiteral, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { ChartRangeToggle, useChartRange } from "@/components/charts/chart-range-toggle";
import { PriceChart } from "@/components/charts/lazy";
import type { PriceOverlay } from "@/components/charts/price-chart";
import { DataState } from "@/components/feedback/data-state";
import { ChartCard } from "@/components/market/chart-card";
import { OVERVIEW_HISTORY } from "@/components/market/stock-header-live";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useHistory } from "@/lib/api/hooks";
import { sliceByRange } from "@/lib/charts/range";
import { freshnessMeta } from "@/lib/freshness";
import { calculateMacd, calculateSimpleMovingAverage } from "@/lib/indicators";

const INDICATORS = ["sma20", "sma50", "macd"] as const;

export function ChartView({ symbol }: { symbol: string }) {
  const t = useTranslations();
  const [range, setRange] = useChartRange();
  const [indicators, setIndicators] = useQueryState("ind", parseAsArrayOf(parseAsStringLiteral(INDICATORS)).withDefault([]));
  const history = useHistory(symbol, OVERVIEW_HISTORY);
  const rows = history.data?.data.rows;
  // Indicators use the full series (so the first visible SMA point is accurate), then follow the range.
  const derived = useMemo(() => {
    if (!rows) return null;
    const closes = rows.map((row) => ({ time: row.date, close: row.close }));
    const sliced = sliceByRange(rows, range);
    const from = sliced.rows[0]?.date ?? "";
    const visible = <T extends { time: string }>(points: T[]) => points.filter((point) => point.time >= from);
    const overlays: PriceOverlay[] = [];
    if (indicators.includes("sma20")) overlays.push({ key: "sma20", label: "SMA 20", points: visible(calculateSimpleMovingAverage(closes, 20)) });
    if (indicators.includes("sma50")) overlays.push({ key: "sma50", label: "SMA 50", points: visible(calculateSimpleMovingAverage(closes, 50)) });
    return { sliced, overlays, macd: indicators.includes("macd") ? visible(calculateMacd(closes)) : undefined };
  }, [rows, range, indicators]);

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="chart-view">
      <DataState query={history}>
        {(envelope) => (
          <ChartCard testId="full-chart" title={t("stockChart.title")} meta={freshnessMeta(envelope)}
            description={derived!.sliced.limited ? t("chart.rangeLimited", { count: envelope.data.rows.length }) : t("stockChart.indicatorsNote")}
            actions={
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup type="multiple" size="sm" variant="outline" value={indicators} onValueChange={(value) => void setIndicators(value.length ? (value as typeof indicators) : null)} aria-label={t("stockChart.indicators")}>
                  {INDICATORS.map((indicator) => <ToggleGroupItem key={indicator} value={indicator} className="px-2 text-xs" data-testid={`ind-${indicator}`}>{t(`stockChart.${indicator}`)}</ToggleGroupItem>)}
                </ToggleGroup>
                <ChartRangeToggle value={range} onChange={(next) => void setRange(next)} />
              </div>
            }
            footer={t("chart.attribution")}>
            <PriceChart rows={derived!.sliced.rows} height={420} overlays={derived!.overlays} macd={derived!.macd} />
          </ChartCard>
        )}
      </DataState>
    </div>
  );
}
