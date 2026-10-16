"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { HelpCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { StatusBadge } from "@/components/feedback/status-badge";
import { Button } from "@/components/ui/button";
import { stockHref } from "@/components/layout/nav-config";
import { Link } from "@/i18n/navigation";
import type { FreshnessMeta } from "@/lib/freshness";
import { criteriaOf, textsOf, type Reason, type ScreenerCandidate } from "@/lib/strategies/contract";
import { DataTable } from "./data-table";

/** "Why matched" as observed criteria. Reasons a source emits but HAKAPRO can't word stay visible as "unrecognized". */
export function CriteriaList({ reasons }: { reasons: Reason[] }) {
  const t = useTranslations("criteria");
  return (
    <span className="flex flex-wrap gap-1">
      {criteriaOf(reasons).map((reason, index) =>
        reason.kind === "criterion" ? (
          <StatusBadge key={`${reason.key}-${index}`} tone="info" data-criterion={reason.key}>
            {t(reason.key)}
          </StatusBadge>
        ) : (
          <StatusBadge key={`unknown-${index}`} tone="neutral" icon={<HelpCircle />} title={reason.label ?? reason.code} data-criterion="unrecognized">
            {t("unrecognized")}
            {reason.label ? `: ${reason.label}` : ""}
          </StatusBadge>
        ),
      )}
    </span>
  );
}

/** Strategy results with the reasons each stock matched. */
export function ScreenerTable({ candidates, meta, caption, maxHeight, onWhy }: { candidates: ScreenerCandidate[]; meta: FreshnessMeta; caption: string; maxHeight?: number; onWhy?: (candidate: ScreenerCandidate) => void }) {
  const t = useTranslations("strategy");
  const tWhy = useTranslations("strategies");
  const columns = useMemo<ColumnDef<ScreenerCandidate, unknown>[]>(() => [
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
    { id: "criteria", header: t("whyMatched"), enableSorting: false, cell: ({ row }) => <CriteriaList reasons={row.original.reasons} /> },
    {
      id: "note", header: t("providerNote"), enableSorting: false,
      cell: ({ row }) => (
        <span className="flex flex-col gap-1">
          {textsOf(row.original.reasons, "pattern").map((pattern) => <span key={pattern} className="caption-style text-soft">{pattern}</span>)}
          <span className="flex flex-wrap gap-1">
            {textsOf(row.original.reasons, "note").map((note) => <StatusBadge key={note} tone="neutral">{note}</StatusBadge>)}
          </span>
        </span>
      ),
    },
    ...(onWhy
      ? [{ id: "why", header: "", enableSorting: false, meta: { className: "w-20 text-right" }, cell: ({ row }) => (
          <Button variant="outline" size="sm" onClick={() => onWhy(row.original)} data-testid={`why-${row.original.symbol}`}>
            {tWhy("why")}
          </Button>
        ) } satisfies ColumnDef<ScreenerCandidate, unknown>]
      : []),
  ], [t, tWhy, onWhy]);
  return <DataTable testId="screener-table" columns={columns} data={candidates} meta={meta} caption={caption} getRowId={(row) => row.symbol} maxHeight={maxHeight} />;
}
