import type { ScreenerContext } from "@/lib/strategies/contract";
import { formatPercent, formatValue, type Locale } from "@/lib/format";
import type { Observation } from "./insight-card";

type T = (key: string, values?: Record<string, string | number>) => string;

/** Market condition and coverage stated by each strategy source, as observations. */
export function screenContextObservations(contexts: ScreenerContext[], t: T, locale: Locale): Observation[] {
  const observations: Observation[] = [];
  const keyed = (id: string, index: number) => (index === 0 ? id : `${id}-${index}`);
  contexts.forEach((context, index) => {
    if (context.marketCondition) {
      observations.push({ id: keyed("condition", index), text: t("strategy.marketCondition", { label: context.marketCondition.label, avg: formatPercent(context.marketCondition.averageChangePercent, locale) }) });
    }
    if (context.universe) {
      observations.push({ id: keyed("universe", index), text: t("strategy.universe", { covered: formatValue(context.universe.covered, "number", locale), liquid: formatValue(context.universe.liquid, "number", locale), skipped: formatValue(context.universe.skipped, "number", locale) }) });
    }
  });
  return observations;
}

/** The sources' stated versions, e.g. "V5.2"; undefined when none states one. */
export function screenContextVersion(contexts: ScreenerContext[]): string | undefined {
  return contexts.map((context) => context.version).filter(Boolean).join(" · ") || undefined;
}
