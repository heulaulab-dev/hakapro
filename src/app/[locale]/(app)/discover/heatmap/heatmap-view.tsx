"use client";

import { parseAsNumberLiteral, parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import type { ReactNode } from "react";
import { DataState } from "@/components/feedback/data-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { Panel } from "@/components/layout/panel";
import { SectionHeader } from "@/components/layout/section-header";
import { AsOfLine, HeatmapBubbles, HeatmapLegend, HeatmapPulse, HeatmapTreemap } from "@/components/market/heatmap";
import { useHeatmapText } from "@/components/market/heatmap/shared";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useHeatmap } from "@/lib/api/hooks";
import type { Heatmap } from "@/lib/api/market";
import type { WithFreshness } from "@/lib/freshness";
import { freshnessMeta } from "@/lib/freshness";
import {
  COLOR_METRICS, colorCap, DIRECTIONS, filterStocks, HEATMAP_LIMITS, HEATMAP_VIEWS, isFiltered, NO_SECTOR, sectorKey, SIZE_METRICS, summarizeSectors,
  type ColorMetric, type HeatmapFilter, type HeatmapView as View, type SizeMetric,
} from "@/lib/heatmap";

const ALL = "all";
const MAP_HEIGHT = 560;
/** Below this width the map keeps a 640px canvas and scrolls sideways instead of squeezing tiles unreadably. */
const MIN_MAP_WIDTH = "min-w-[640px]";

export function HeatmapView() {
  const { t } = useHeatmapText();
  const [view, setView] = useQueryState("view", parseAsStringLiteral(HEATMAP_VIEWS).withDefault("treemap"));
  const [limit, setLimit] = useQueryState("top", parseAsNumberLiteral(HEATMAP_LIMITS).withDefault(100));
  const [direction, setDirection] = useQueryState("dir", parseAsStringLiteral(DIRECTIONS).withDefault("all"));
  const [sector, setSector] = useQueryState("sector", parseAsString);
  const [query, setQuery] = useQueryState("q", parseAsString.withDefault(""));
  const [sizeBy, setSizeBy] = useQueryState("size", parseAsStringLiteral(SIZE_METRICS).withDefault("value"));
  const [colorBy, setColorBy] = useQueryState("color", parseAsStringLiteral(COLOR_METRICS).withDefault("change"));
  const [yBy, setYBy] = useQueryState("y", parseAsStringLiteral(SIZE_METRICS).withDefault("value"));
  const heatmap = useHeatmap(limit);
  const meta = heatmap.data ? freshnessMeta(heatmap.data) : undefined;
  const filter: HeatmapFilter = { direction, sector, query };

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="heatmap-view">
      <SectionHeader as="h1" title={t("title")} description={t("intro")} meta={meta} />

      <div role="group" aria-label={t("controls")} className="flex flex-wrap items-center gap-2" data-testid="heatmap-controls">
        <Toggle label={t("viewLabel")} value={view} values={HEATMAP_VIEWS} onChange={(value) => void setView(value === "treemap" ? null : value)} text={(value) => t(`views.${value}`)} testId="heatmap-view-toggle" />
        <Toggle label={t("limitLabel")} value={String(limit)} values={HEATMAP_LIMITS.map(String)} onChange={(value) => void setLimit(value === "100" ? null : (Number(value) as 30 | 50))} text={(value) => t("limit", { count: Number(value) })} testId="heatmap-limit" />
        <Toggle label={t("directionLabel")} value={direction} values={DIRECTIONS} onChange={(value) => void setDirection(value === "all" ? null : value)} text={(value) => t(`direction.${value}`)} testId="heatmap-direction" />
        <Select value={sector ?? ALL} onValueChange={(value) => void setSector(value === ALL ? null : value)} disabled={!heatmap.data?.data.sectors.length}>
          <SelectTrigger className="h-8 w-48 text-xs" aria-label={t("sectorLabel")} data-testid="heatmap-sector"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allSectors")}</SelectItem>
            {/* The selected sector stays listed even when a new limit no longer includes it. */}
            {[...new Set([...(heatmap.data?.data.sectors ?? []).map((row) => sectorKey(row.sector)), ...(sector ? [sector] : [])])].map((key) => (
              <SelectItem key={key} value={key}>{key === NO_SECTOR ? t("unknownSector") : key}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="search" value={query} onChange={(event) => void setQuery(event.target.value || null)} aria-label={t("searchLabel")} placeholder={t("searchPlaceholder")} className="h-8 w-44 text-xs" data-testid="heatmap-search" />
        {view === "treemap" && <Toggle label={t("sizeLabel")} value={sizeBy} values={SIZE_METRICS} onChange={(value) => void setSizeBy(value === "value" ? null : value)} text={(value) => t(`size.${value}`)} testId="heatmap-size" />}
        {view === "bubbles" && <Toggle label={t("yLabel")} value={yBy} values={SIZE_METRICS} onChange={(value) => void setYBy(value === "value" ? null : value)} text={(value) => t(`y.${value}`)} testId="heatmap-y" />}
        {view !== "pulse" && <Toggle label={t("colorLabel")} value={colorBy} values={COLOR_METRICS} onChange={(value) => void setColorBy(value === "change" ? null : value)} text={(value) => t(`color.${value}`)} testId="heatmap-color" />}
      </div>

      <Panel testId="heatmap-panel" title={t("scope", { count: limit })} meta={meta}>
        <DataState query={heatmap} isEmpty={(envelope) => envelope.data.stocks.length === 0}>
          {(envelope) => (
            <HeatmapBody envelope={envelope} view={view} filter={filter} sizeBy={sizeBy} colorBy={colorBy} yBy={yBy} onPickSector={(key) => { void setSector(key); void setView(null); }} />
          )}
        </DataState>
      </Panel>
    </div>
  );
}

function HeatmapBody({ envelope, view, filter, sizeBy, colorBy, yBy, onPickSector }: {
  envelope: WithFreshness<Heatmap>; view: View; filter: HeatmapFilter; sizeBy: SizeMetric; colorBy: ColorMetric; yBy: SizeMetric; onPickSector: (key: string) => void;
}) {
  const { t } = useHeatmapText();
  const { stocks, sectors } = envelope.data;
  const shown = filterStocks(stocks, filter);
  const withForeign = stocks.filter((stock) => stock.netForeignValueEstimateIdr !== null).length;
  const foreignNeeded = view !== "pulse" && (colorBy === "foreign" || (view === "treemap" ? sizeBy : yBy) === "foreign");
  const positioned = view === "treemap" && sizeBy === "foreign" || view === "bubbles" && yBy === "foreign";
  const hidden = positioned ? shown.filter((stock) => stock.netForeignValueEstimateIdr === null).length : 0;
  // Without filters the engine's own sector totals are shown; with filters they are recomputed over what is shown.
  const pulseSectors = isFiltered({ ...filter, sector: null }) ? summarizeSectors(shown) : sectors.filter((row) => filter.sector === null || sectorKey(row.sector) === filter.sector);

  let body: ReactNode;
  if (!shown.length) body = <EmptyState compact title={t("noMatch")} />;
  else if (positioned && hidden === shown.length) body = <EmptyState compact title={t("noForeign")} />;
  else if (view === "pulse") body = <HeatmapPulse sectors={pulseSectors} onPick={onPickSector} />;
  else {
    body = (
      <div className="flex flex-col gap-2">
        <HeatmapLegend colorBy={colorBy} cap={colorCap(shown, colorBy)} />
        {view === "bubbles" && <p className="caption-style text-subtle">{t("bubbleHint")}</p>}
        <p className="caption-style text-subtle sm:hidden">{t("mobileHint")}</p>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-testid="heatmap-scroll">
          <div className={MIN_MAP_WIDTH}>
            {view === "treemap"
              ? <HeatmapTreemap stocks={shown} sizeBy={sizeBy} colorBy={colorBy} height={MAP_HEIGHT} />
              : <HeatmapBubbles stocks={shown} yBy={yBy} colorBy={colorBy} height={MAP_HEIGHT - 80} />}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <AsOfLine meta={freshnessMeta(envelope)} />
        <p className="caption-style text-subtle" data-testid="heatmap-coverage">{t("coverage", { count: stocks.length, foreign: withForeign })}</p>
      </div>
      {body}
      {hidden > 0 && hidden < shown.length && <p className="caption-style text-subtle" data-testid="heatmap-foreign-hidden">{t("foreignHidden", { count: hidden })}</p>}
      {(foreignNeeded || withForeign > 0) && <p className="caption-style leading-snug text-subtle" data-testid="heatmap-foreign-note">{t("foreignNote")}</p>}
    </div>
  );
}

function Toggle<T extends string>({ label, value, values, onChange, text, testId }: {
  label: string; value: T; values: readonly T[]; onChange: (value: T) => void; text: (value: T) => string; testId: string;
}) {
  return (
    <ToggleGroup type="single" size="sm" variant="outline" value={value} onValueChange={(next) => next && onChange(next as T)} aria-label={label} data-testid={testId}>
      {values.map((option) => <ToggleGroupItem key={option} value={option} className="px-2.5 text-xs" data-testid={`${testId}-${option}`}>{text(option)}</ToggleGroupItem>)}
    </ToggleGroup>
  );
}
