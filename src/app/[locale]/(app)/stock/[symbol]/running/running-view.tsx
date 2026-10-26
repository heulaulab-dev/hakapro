"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { parseAsInteger, useQueryState } from "nuqs";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { DataTable } from "@/components/data/data-table";
import { DataState } from "@/components/feedback/data-state";
import { ResearchDisclaimer } from "@/components/feedback/research-disclaimer";
import { StatusBadge } from "@/components/feedback/status-badge";
import { SectionHeader } from "@/components/layout/section-header";
import { Button } from "@/components/ui/button";
import { useDoneDetails } from "@/lib/api/hooks";
import type { DoneDetailRow } from "@/lib/api/market";
import { freshnessMeta } from "@/lib/freshness";
import { formatIdr, formatVolume, type Locale } from "@/lib/format";

/** The running-trade tab: today's executed trades (arjum "done details"), paginated, newest first. One provider
 *  request per page, only on a user action. 100 rows per page; a liquid stock has tens of thousands of trades a day,
 *  so this is a window onto the tape, not the whole tape. */
export function RunningTradeView({ symbol }: { symbol: string }) {
  const t = useTranslations("runningTrade");
  const locale = useLocale() as Locale;
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  const query = useDoneDetails(symbol, null, page);

  const columns = useMemo<ColumnDef<DoneDetailRow, unknown>[]>(() => {
    // F = foreign, D = domestic investor type for each side of the trade.
    const party = (code: string) => (code === "F" ? t("foreign") : code === "D" ? t("domestic") : code);
    return [
    { accessorKey: "time", header: t("time"), cell: ({ getValue }) => <span className="num whitespace-nowrap">{getValue<string>()}</span> },
    { accessorKey: "board", header: t("board"), cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue<string>()}</span> },
    { accessorKey: "priceIdr", header: t("price"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale) },
    { accessorKey: "lots", header: t("lots"), meta: { numeric: true }, cell: ({ getValue }) => formatVolume(getValue<number>(), locale, { compact: true }) },
    { accessorKey: "valueIdr", header: t("value"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number>(), locale, { compact: true }) },
    { id: "buyer", accessorKey: "buyer", header: t("buyer"), cell: ({ row }) => <span className="ticker whitespace-nowrap">{row.original.buyer}<span className="ml-1 text-[11px] text-muted-foreground">{party(row.original.buyerType)}</span></span> },
    { id: "seller", accessorKey: "seller", header: t("seller"), cell: ({ row }) => <span className="ticker whitespace-nowrap">{row.original.seller}<span className="ml-1 text-[11px] text-muted-foreground">{party(row.original.sellerType)}</span></span> },
    { accessorKey: "aggressor", header: t("aggressor"), cell: ({ getValue }) => {
      const action = getValue<string>();
      const label = action === "BUY" || action === "SELL" ? t(`actions.${action}`) : action;
      return <StatusBadge tone={action === "BUY" ? "positive" : action === "SELL" ? "negative" : "neutral"}>{label}</StatusBadge>;
    } },
    ];
  }, [t, locale]);

  return (
    <div className="flex flex-col gap-section p-4 md:p-6" data-testid="running-trade-view">
      <SectionHeader title={t("title")} description={t("note")} />
      <DataState query={query}>
        {(envelope) => {
          const data = envelope.data;
          return (
            <div className="flex flex-col gap-3">
              <DataTable mobile="cards" testId="running-trade-table" columns={columns} data={data.rows} meta={freshnessMeta(envelope)} caption={t("title")} />
              <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span className="num" data-testid="running-page">{t("page", { page: data.page, total: Math.max(1, data.totalPages) })}</span>
                <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => void setPage(data.page - 1 > 1 ? data.page - 1 : null)}>{t("previous")}</Button>
                <Button variant="outline" size="sm" disabled={data.page >= data.totalPages} onClick={() => void setPage(data.page + 1)}>{t("next")}</Button>
              </div>
            </div>
          );
        }}
      </DataState>
      <ResearchDisclaimer />
    </div>
  );
}
