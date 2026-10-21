"use client";

import { DataState } from "@/components/feedback/data-state";
import { Panel } from "@/components/layout/panel";
import { Link } from "@/i18n/navigation";
import { useHeatmap } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { HeatmapTreemap } from "./treemap";
import { AsOfLine, useHeatmapText } from "./shared";

/**
 * Compact home-page heatmap: the 30 most-traded stocks, area by traded value, color by change, no sector headers.
 * Self-contained (own query, freshness, as-of and empty/UNSUPPORTED states) so it can drop into any grid cell.
 */
export function HeatmapPreview({ height = 240, className }: { height?: number; className?: string }) {
  const { t } = useHeatmapText();
  const query = useHeatmap(30);
  return (
    <Panel testId="heatmap-preview" className={className} title={t("previewTitle")} description={t("previewHint")} meta={query.data ? freshnessMeta(query.data) : undefined}
      actions={<Link href="/discover/heatmap" className="caption-style text-link hover:underline" data-testid="heatmap-preview-more">{t("previewMore")}</Link>}>
      <DataState query={query} compact isEmpty={(envelope) => envelope.data.stocks.length === 0}>
        {(envelope) => (
          <div className="flex flex-col gap-2">
            <HeatmapTreemap stocks={envelope.data.stocks} sizeBy="value" colorBy="change" height={height} compact testId="heatmap-preview-treemap" />
            <AsOfLine meta={freshnessMeta(envelope)} className="caption-style text-[11px] text-subtle" />
          </div>
        )}
      </DataState>
    </Panel>
  );
}
