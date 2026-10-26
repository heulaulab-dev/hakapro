"use client";

import { useLocale, useTranslations } from "next-intl";
import { Sparkline } from "@/components/kit/sparkline";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { SectionHeader } from "@/components/layout/section-header";
import { ChangeValue } from "@/components/market/change-value";
import { useMacro } from "@/lib/api/hooks";
import type { MacroSeries } from "@/lib/api/market";
import { formatDate, type Locale } from "@/lib/format";
import { freshnessMeta } from "@/lib/freshness";

const RATE_IDS = new Set(["BI_RATE", "JISDOR"]);

/** The IDX stocks each commodity moves, shown under its card so the macro number ties to the market. */
const COMMODITY_TICKERS: Record<string, string[]> = {
  "wb.coal_au": ["ADRO", "PTBA", "ITMG", "HRUM"],
  "wb.crude_brent": ["MEDC", "ELSA", "PGAS"],
  "wb.gas_lng_jp": ["PGAS", "MEDC"],
  "wb.palm_oil": ["AALI", "LSIP", "DSNG", "TAPG"],
  "wb.rubber_tsr20": ["BRPT", "GJTL"],
  "wb.nickel": ["INCO", "ANTM", "NCKL", "MBMA"],
  "wb.copper": ["AMMN", "MDKA", "BRMS"],
  "wb.tin": ["TINS"],
  "wb.gold": ["MDKA", "ANTM", "BRMS"],
};

/** Percent change of the latest observation versus the previous one, or null when there is no baseline. */
function pctChange(series: MacroSeries): number | null {
  if (series.previousValue == null || series.previousValue === 0) return null;
  return ((series.value - series.previousValue) / series.previousValue) * 100;
}

function SeriesCard({ series, tickers }: { series: MacroSeries; tickers?: string[] }) {
  const locale = useLocale() as Locale;
  const num = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  // Observations arrive newest-first; the sparkline reads oldest → newest.
  const spark = [...series.observations].map((o) => o.value).reverse();
  const change = pctChange(series);
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-border px-cell-x py-3" data-testid={`macro-${series.id}`}>
      <span className="truncate text-xs text-muted-foreground">{series.name}</span>
      <span className="ticker text-base leading-tight font-semibold break-words sm:text-lg">
        {num.format(series.value)} <span className="text-xs font-normal text-muted-foreground">{series.unit}</span>
      </span>
      <div className="flex items-center gap-2 text-xs">
        {change !== null && <ChangeValue percent={change} />}
        {spark.length > 1 && <Sparkline values={spark.map((v) => Math.max(0, v))} />}
      </div>
      {tickers && tickers.length > 0 && <span className="truncate text-[11px] text-subtle">{tickers.join(" · ")}</span>}
      <span className="num text-[11px] text-subtle">{formatDate(series.date, locale)}</span>
    </div>
  );
}

export function MacroView() {
  const t = useTranslations("macro");
  const query = useMacro();
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="macro-view">
      <DataState query={query}>
        {(envelope) => {
          const series = envelope.data.series;
          const rates = series.filter((s) => RATE_IDS.has(s.id));
          const commodities = series.filter((s) => s.id.startsWith("wb."));
          return (
            <div className="flex flex-col gap-section">
              {rates.length > 0 && (
                <section className="flex flex-col gap-3" data-testid="macro-rates">
                  <SectionHeader title={t("rates")} description={t("ratesNote")} meta={freshnessMeta(envelope)} />
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                    {rates.map((s) => <SeriesCard key={s.id} series={s} />)}
                  </div>
                </section>
              )}
              <section className="flex flex-col gap-3" data-testid="macro-commodities">
                <SectionHeader title={t("commodities")} description={t("commoditiesNote")} />
                {commodities.length === 0
                  ? <EmptyState compact title={t("commoditiesEmpty")} />
                  : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                      {commodities.map((s) => <SeriesCard key={s.id} series={s} tickers={COMMODITY_TICKERS[s.id]} />)}
                    </div>
                  )}
                <p className="caption-style text-subtle">{t("worldBankAttribution")}</p>
              </section>
            </div>
          );
        }}
      </DataState>
      <ResearchDisclaimer />
    </div>
  );
}
