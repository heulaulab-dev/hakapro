import type { StrategyScreen } from "@/lib/api/market";
import { formatPercent, formatValue, type Locale } from "@/lib/format";
import type { Observation } from "./insight-card";

type T = (key: string, values?: Record<string, string | number>) => string;

/** Market condition and coverage stated by the screener provider, as observations. */
export function screenContextObservations(screen: StrategyScreen, t: T, locale: Locale): Observation[] {
  const observations: Observation[] = [];
  if (screen.marketCondition) {
    observations.push({ id: "condition", text: t("strategy.marketCondition", { label: screen.marketCondition.label, avg: formatPercent(screen.marketCondition.averageChangePercent, locale) }) });
  }
  if (screen.universe) {
    observations.push({ id: "universe", text: t("strategy.universe", { covered: formatValue(screen.universe.covered, "number", locale), liquid: formatValue(screen.universe.liquid, "number", locale), skipped: formatValue(screen.universe.skipped, "number", locale) }) });
  }
  return observations;
}
