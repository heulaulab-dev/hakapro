"use client";

import { AlertTriangle } from "@/components/kit/icons";
import { useLocale, useTranslations } from "next-intl";
import { StatusBadge } from "@/components/feedback/status-badge";
import type { Radar, RadarStock } from "@/lib/api/market";
import { formatDate, formatNumber, formatPercent, formatVolume, type Locale } from "@/lib/format";
import type { RadarCounterKey, RadarSignalKey, RadarUnit } from "@/lib/radar/rules";

type Fired = RadarStock["fired"][number];
type Counter = RadarStock["counter"][number];
type Rules = Radar["rules"];

const sessionsOf = (window: string) => Number(window.replace(/D$/, ""));

/** Formats a rule value in its unit: fractions as percent, ratios as multiples, counts as whole numbers. */
export function formatRuleValue(value: number, unit: RadarUnit, locale: Locale, options: { signed?: boolean } = {}): string {
  if (unit === "fraction") return formatPercent(value * 100, locale, { decimals: 1, signed: options.signed ?? false });
  if (unit === "ratio") return `${formatNumber(value, locale, { decimals: 1 })}×`;
  return formatNumber(value, locale, { decimals: 0 });
}

/** Plain-language text for signals and counter-evidence, built only from the observed figures. */
export function useRadarText() {
  const t = useTranslations("radar");
  const locale = useLocale() as Locale;
  const pct = (fraction: number | null | undefined) => formatPercent(Math.abs(fraction ?? 0) * 100, locale, { decimals: 1, signed: false });
  const ratio = (value: number | null | undefined) => formatNumber(value ?? null, locale, { decimals: 1 });
  const month = (value: string) => formatDate(value, locale);

  function signal(item: Fired, rules: Rules): string {
    const baseline = rules[item.key].baseline ?? 0;
    switch (item.key) {
      case "foreignNetBuy5":
      case "foreignNetBuy20":
        return t("signal.foreignNetBuy", { sessions: sessionsOf(item.window), share: pct(item.observed) });
      case "volumeSpike": return t("signal.volumeSpike", { ratio: ratio(item.observed), baseline });
      case "closeAboveAverage": return t("signal.closeAboveAverage", { pct: pct(item.observed), baseline });
      case "priceUp5": return t("signal.priceUp", { pct: pct(item.observed), sessions: sessionsOf(item.window) });
      case "orderSizeSpike": return t("signal.orderSizeSpike", { ratio: ratio(item.observed), baseline });
      case "kseiHolderIncrease": return t("signal.kseiHolderIncrease", { count: item.observed, month: month(item.window) });
    }
  }

  function counter(item: Counter): string {
    const values = item.values;
    switch (item.key) {
      case "priceVsForeign5":
      case "priceVsForeign20":
        return t("counter.priceVsForeign", {
          direction: (values.priceChange ?? 0) > 0 ? "up" : "down", pct: pct(values.priceChange),
          flow: (values.foreignNetShares ?? 0) < 0 ? "sell" : "buy",
          shares: formatVolume(Math.abs(values.foreignNetShares ?? 0), locale, { compact: true }), sessions: sessionsOf(item.window),
        });
      case "volumeOnDownSession": return t("counter.volumeOnDownSession", { ratio: ratio(values.volumeRatio), pct: pct(values.changePercent) });
      case "kseiHolderDecrease": return t("counter.kseiHolderDecrease", { count: values.decreases ?? 0, month: month(item.window) });
    }
  }

  /** Signal name with its windows, as listed in the methodology and the data-status line. */
  function name(key: RadarSignalKey, rules: Rules): string {
    return t(`name.${key}`, { window: rules[key].window ?? 0, baseline: rules[key].baseline ?? 0 });
  }

  function counterName(key: RadarCounterKey): string {
    return t(`counterName.${key}`);
  }

  return { signal, counter, name, counterName };
}

export function SignalChip({ item, rules }: { item: Fired; rules: Rules }) {
  const text = useRadarText();
  return <StatusBadge tone="info" data-testid="radar-signal" data-key={item.key} className="h-auto min-h-[18px] whitespace-normal py-0.5 text-left">{text.signal(item, rules)}</StatusBadge>;
}

export function CounterChip({ item }: { item: Counter }) {
  const text = useRadarText();
  return (
    <StatusBadge tone="warning" icon={<AlertTriangle />} data-testid="radar-counter" data-key={item.key} className="h-auto min-h-[18px] whitespace-normal py-0.5 text-left">
      {text.counter(item)}
    </StatusBadge>
  );
}
