"use client";

import { parseAsInteger, parseAsStringLiteral, useQueryState } from "nuqs";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { InsiderHolders } from "@/components/data/insider-holders";
import { InsidersTable } from "@/components/data/insiders-table";
import { Segmented } from "@/components/kit/segmented";
import { DataState } from "@/components/feedback/data-state";
import { SectionHeader } from "@/components/layout/section-header";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useInsiderDisclosures, useInsidersPage } from "@/lib/api/hooks";
import { freshnessMeta } from "@/lib/freshness";
import { groupInsidersByHolder } from "@/lib/insider-holders";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";

const ACTIONS = ["BUY", "SELL", "CROSS"] as const;
const VIEWS = ["holders", "transactions"] as const;
const LIMIT = ARJUM_LIMITS.insiders;

export function InsidersView({ symbol }: { symbol: string }) {
  const t = useTranslations();
  const [view, setView] = useQueryState("view", parseAsStringLiteral(VIEWS).withDefault("holders"));
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="insiders-view">
      <SectionHeader title={t("stockInsiders.title")} actions={
        <Segmented value={view} onChange={(value) => void setView(value === "holders" ? null : value)}
          options={VIEWS.map((value) => ({ value, label: <span data-testid={`insiders-view-${value}`}>{t(`insiderHolders.views.${value}`)}</span> }))} />
      } />
      {view === "holders" ? <HoldersSection symbol={symbol} /> : <TransactionsSection symbol={symbol} />}
    </div>
  );
}

function HoldersSection({ symbol }: { symbol: string }) {
  const query = useInsiderDisclosures(symbol, LIMIT);
  // Keep only pages the provider actually served as requested; a source that ignores `page` stops here.
  const pages = useMemo(() => {
    const served = query.data?.pages ?? [];
    const index = served.findIndex((envelope, position) => envelope.data.page !== position + 1);
    return index === -1 ? served : served.slice(0, index);
  }, [query.data]);
  const groups = useMemo(() => groupInsidersByHolder(pages.flatMap((envelope) => envelope.data.rows)), [pages]);
  const olderUnavailable = (query.data?.pages.length ?? 0) > pages.length;
  return (
    <DataState query={query} isEmpty={() => groups.length === 0}>
      {() => {
        const first = pages[0];
        const loaded = pages.reduce((sum, envelope) => sum + envelope.data.rows.length, 0);
        return (
          <InsiderHolders groups={groups} meta={freshnessMeta(first)} coverage={{
            loaded, total: first.data.total, olderUnavailable,
            canLoadOlder: Boolean(query.hasNextPage) && !olderUnavailable, loadingOlder: query.isFetchingNextPage,
            onLoadOlder: () => void query.fetchNextPage(),
          }} />
        );
      }}
    </DataState>
  );
}

function TransactionsSection({ symbol }: { symbol: string }) {
  const t = useTranslations();
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  const [action, setAction] = useQueryState("action", parseAsStringLiteral(ACTIONS));
  const query = useInsidersPage(symbol, page, LIMIT, action);
  return (
    <>
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
    </>
  );
}
