"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Button } from "@/components/ui/button";
import { stockHref } from "@/components/layout/nav-config";
import { Link } from "@/i18n/navigation";
import type { Criterion, StrategyMatch } from "@/lib/api/market";
import type { FreshnessMeta } from "@/lib/freshness";
import { DataTable } from "./data-table";

/** "Why matched" as observed criteria. Unknown provider flags stay visible as "unrecognized". */
export function CriteriaList({ criteria }: { criteria: Criterion[] }) {
  const t = useTranslations("criteria");
  return (
    <span className="flex flex-wrap gap-1">
      {criteria.map((criterion, index) =>
        criterion.kind === "recognized" ? (
          <StatusBadge key={`${criterion.key}-${index}`} tone="info" data-criterion={criterion.key}>
            {t(criterion.key)}
          </StatusBadge>
        ) : (
          <StatusBadge key={`unknown-${index}`} tone="neutral" icon={<HelpCircle />} title={criterion.providerLabel ?? criterion.flag} data-criterion="unrecognized">
            {t("unrecognized")}
            {criterion.providerLabel ? `: ${criterion.providerLabel}` : ""}
          </StatusBadge>
        ),
      )}
    </span>
  );
}

/** Strategy/screen results with the reasons each stock matched. */
export function ScreenerTable({ matches, meta, caption, maxHeight, onWhy }: { matches: StrategyMatch[]; meta: FreshnessMeta; caption: string; maxHeight?: number; onWhy?: (match: StrategyMatch) => void }) {
  const t = useTranslations("strategy");
  const tWhy = useTranslations("strategies");
  const columns = useMemo<ColumnDef<StrategyMatch, unknown>[]>(() => [
    {
      id: "symbol",
      accessorKey: "symbol",
      header: t("symbol"),
      meta: { className: "w-20" },
      cell: ({ row }) => (
        <Link href={stockHref(row.original.symbol)} className="ticker font-medium text-link hover:underline" data-testid={`screener-symbol-${row.original.symbol}`}>
          {row.original.symbol}
        </Link>
      ),
    },
    { id: "name", accessorKey: "name", header: t("company"), cell: ({ row }) => <span className="text-muted-foreground">{row.original.name}</span> },
    { id: "criteria", header: t("whyMatched"), enableSorting: false, cell: ({ row }) => <CriteriaList criteria={row.original.criteria} /> },
    {
      id: "note", header: t("providerNote"), enableSorting: false,
      cell: ({ row }) => (
        <span className="flex flex-col gap-1">
          {row.original.pattern && <span className="caption-style text-soft">{row.original.pattern}</span>}
          <span className="flex flex-wrap gap-1">
            {row.original.notes.map((note) => <StatusBadge key={note} tone="neutral">{note}</StatusBadge>)}
          </span>
        </span>
      ),
    },
    ...(onWhy
      ? [{ id: "why", header: "", enableSorting: false, meta: { className: "w-20 text-right" }, cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => onWhy(row.original)} data-testid={`why-${row.original.symbol}`}>
            {tWhy("why")}
          </Button>
        ) } satisfies ColumnDef<StrategyMatch, unknown>]
      : []),
  ], [t, tWhy, onWhy]);
  return <DataTable testId="screener-table" columns={columns} data={matches} meta={meta} caption={caption} getRowId={(row) => row.symbol} maxHeight={maxHeight} />;
}
