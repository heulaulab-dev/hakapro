"use client";

import { useLocale, useTranslations } from "next-intl";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import type { Seasonality } from "@/lib/api/market";
import type { FreshnessMeta } from "@/lib/freshness";
import { formatMonthName, formatNumber, formatPercent, type Locale } from "@/lib/format";

/**
 * Years × months of returns. Diverging fill (up/down tokens) whose opacity scales with magnitude,
 * capped at ±10%; every cell also prints its signed value, so color is never the only channel.
 */
export function SeasonalityHeatmap({ data, meta }: { data: Seasonality; meta: FreshnessMeta }) {
  const t = useTranslations("stockHistory");
  const locale = useLocale() as Locale;
  const cell = (value: number | null) => {
    if (value === null) return { style: undefined, text: "—" };
    const alpha = Math.min(Math.abs(value) / 10, 1) * 0.55 + 0.05;
    return { style: { background: `color-mix(in oklab, var(${value >= 0 ? "--chart-up" : "--chart-down"}) ${Math.round(alpha * 100)}%, transparent)` }, text: formatPercent(value, locale, { decimals: 1 }) };
  };
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-card" data-testid="seasonality">
      <div className="flex items-center justify-between gap-2 border-b border-border px-cell-x py-2">
        <h3 className="text-sm font-semibold">{t("seasonality")}</h3>
        <FreshnessBadge {...meta} />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0.5 text-[11px]" aria-label={t("seasonality")}>
          <thead>
            <tr>
              <th className="px-1.5 py-1 text-left font-medium text-muted-foreground">{t("year")}</th>
              {data.months.map((month, index) => <th key={month} className="px-1.5 py-1 text-right font-medium text-muted-foreground">{formatMonthName(index + 1, locale)}</th>)}
              <th className="px-1.5 py-1 text-right font-medium text-muted-foreground">{t("average")}</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.year}>
                <th scope="row" className="ticker px-1.5 py-1 text-left font-normal">{row.year}</th>
                {row.valuesPercent.map((value, index) => { const c = cell(value); return <td key={index} className="ticker rounded-sm px-1.5 py-1 text-right" style={c.style}>{c.text}</td>; })}
                <td className="ticker px-1.5 py-1 text-right font-medium">{formatPercent(row.averagePercent, locale, { decimals: 2 })}</td>
              </tr>
            ))}
            <tr className="border-t border-border">
              <th scope="row" className="px-1.5 py-1 text-left font-medium text-muted-foreground">{t("average")}</th>
              {data.summary.map((item) => { const c = cell(item.averagePercent); return <td key={item.month} className="ticker rounded-sm px-1.5 py-1 text-right font-medium" style={c.style}>{c.text}</td>; })}
              <td />
            </tr>
            <tr>
              <th scope="row" className="px-1.5 py-1 text-left font-medium text-muted-foreground">{t("upProbability")}</th>
              {data.summary.map((item) => <td key={item.month} className="ticker px-1.5 py-1 text-right text-muted-foreground" title={`${t("samples")}: ${item.samples}`}>{item.upProbability === null ? "—" : `${formatNumber(item.upProbability, locale, { decimals: 0 })}%`}</td>)}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
