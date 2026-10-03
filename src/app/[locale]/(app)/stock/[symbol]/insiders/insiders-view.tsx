"use client";

import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { InsidersTable } from "@/components/data/insiders-table";
import { DataState } from "@/components/feedback/data-state";
import { SectionHeader } from "@/components/layout/section-header";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useInsidersPage } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";

const ACTIONS = ["BUY", "SELL", "CROSS"] as const;
const LIMIT = ARJUM_LIMITS.insiders;

export function InsidersView({ symbol }: { symbol: string }) {
  const t = useTranslations();
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  const [action, setAction] = useQueryState("action", parseAsStringLiteral(ACTIONS));
  const query = useInsidersPage(symbol, page, LIMIT, action);
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="insiders-view">
      <SectionHeader title={t("stockInsiders.title")} />
      <DataState query={query}>
        {(envelope) => {
          const data = envelope.data;
          // Fixture recordings ignore the provider-side filter, so it's also applied here.
          const rows = action ? data.rows.filter((row) => row.action === action) : data.rows;
          return (
            <div className="flex flex-col gap-3">
              <InsidersTable rows={rows} meta={freshnessMeta(envelope)}
                toolbar={
                  <ToggleGroup type="single" size="sm" variant="outline" value={action ?? ""} onValueChange={(value) => { void setAction((value || null) as typeof action); void setPage(null); }} aria-label={t("insiders.action")}>
                    {ACTIONS.map((value) => <ToggleGroupItem key={value} value={value} className="px-2.5 text-xs" data-testid={`insider-action-${value}`}>{t(`insiders.actions.${value}`)}</ToggleGroupItem>)}
                  </ToggleGroup>
                } />
              <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span className="num" data-testid="insider-page">{t("stockInsiders.page", { page: data.page, total: Math.max(1, data.totalPages) })}</span>
                <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => void setPage(data.page - 1 > 1 ? data.page - 1 : null)}>{t("stockInsiders.previous")}</Button>
                <Button variant="outline" size="sm" disabled={data.page >= data.totalPages} onClick={() => void setPage(data.page + 1)}>{t("stockInsiders.next")}</Button>
              </div>
            </div>
          );
        }}
      </DataState>
    </div>
  );
}
