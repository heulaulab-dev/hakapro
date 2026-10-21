"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, type ReactNode } from "react";
import { StatusBadge } from "@/components/feedback/status-badge";
import { stockHref } from "@/components/layout/nav-config";
import { Link } from "@/i18n/navigation";
import type { InsiderRow } from "@/lib/api/market";
import type { FreshnessMeta } from "@/lib/freshness";
import { formatDate, formatIdr, formatPercent, formatVolume, type Locale } from "@/lib/format";
import { DataTable } from "./data-table";

export type InsiderTableRow = InsiderRow & { symbol?: string; valueIdr?: number | null };

/**
 * Reported insider transactions; numbers come parsed from provider strings (never raw text).
 * `showValue` adds |shares| × price (IDR) for feeds that send it; a missing price shows a dash, never 0.
 */
export function InsidersTable({ rows, meta, showSymbol, showValue, toolbar, testId = "insiders-table" }: { rows: InsiderTableRow[]; meta: FreshnessMeta; showSymbol?: boolean; showValue?: boolean; toolbar?: ReactNode; testId?: string }) {
  const t = useTranslations("insiders");
  const locale = useLocale() as Locale;
  const columns = useMemo<ColumnDef<InsiderTableRow, unknown>[]>(() => [
    { accessorKey: "date", header: t("date"), cell: ({ getValue }) => <span className="num whitespace-nowrap">{formatDate(getValue<string>(), locale)}</span> },
    ...(showSymbol ? [{ id: "symbol", accessorKey: "symbol", header: "", cell: ({ row }) => <Link href={stockHref(row.original.symbol!, "insiders")} className="ticker text-link hover:underline">{row.original.symbol}</Link> } satisfies ColumnDef<InsiderTableRow, unknown>] : []),
    { accessorKey: "person", header: t("person"), cell: ({ row }) => <span className="flex flex-col"><span className="block max-w-60 truncate" title={row.original.person}>{row.original.person}</span>{row.original.roles.length > 0 && <span className="text-[11px] text-muted-foreground">{row.original.roles.join(", ")}</span>}</span> },
    { accessorKey: "action", header: t("action"), cell: ({ row }) => <StatusBadge tone={row.original.action === "BUY" ? "positive" : row.original.action === "SELL" ? "negative" : "neutral"}>{t(`actions.${row.original.action}`)}</StatusBadge> },
    { accessorKey: "changeShares", header: t("change"), meta: { numeric: true }, cell: ({ getValue }) => formatVolume(getValue<number | null>(), locale, { compact: true }) },
    { accessorKey: "currentShares", header: t("holding"), meta: { numeric: true }, cell: ({ row }) => <span className="flex flex-col items-end"><span>{formatVolume(row.original.currentShares, locale, { compact: true })}</span><span className="text-[11px] text-muted-foreground">{formatPercent(row.original.currentPercent, locale, { decimals: 4, signed: false })}</span></span> },
    { accessorKey: "priceIdr", header: t("price"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number | null>(), locale) },
    ...(showValue ? [{ id: "valueIdr", accessorFn: (row) => row.valueIdr ?? null, header: t("value"), meta: { numeric: true }, cell: ({ getValue }) => formatIdr(getValue<number | null>(), locale, { compact: true }) } satisfies ColumnDef<InsiderTableRow, unknown>] : []),
  ], [t, locale, showSymbol, showValue]);
  return <DataTable testId={testId} columns={columns} data={rows} meta={meta} caption={t("title")} toolbar={toolbar} initialSorting={[{ id: "date", desc: true }]} />;
}
