"use client";

import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CHART_RANGES, DEFAULT_RANGE, type ChartRange } from "@/lib/charts/range";

/** Chart range lives in the URL (?range=6M) so views are shareable. */
export function useChartRange(param = "range") {
  return useQueryState(param, parseAsStringLiteral(CHART_RANGES).withDefault(DEFAULT_RANGE));
}

export function ChartRangeToggle({ value, onChange }: { value: ChartRange; onChange: (range: ChartRange) => void }) {
  const t = useTranslations("chart");
  return (
    <ToggleGroup type="single" size="sm" variant="outline" value={value} onValueChange={(next) => next && onChange(next as ChartRange)} aria-label={t("rangeLabel")}>
      {CHART_RANGES.map((range) => (
        <ToggleGroupItem key={range} value={range} className="ticker px-2 text-xs" data-testid={`range-${range}`}>
          {t(`ranges.${range}`)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
