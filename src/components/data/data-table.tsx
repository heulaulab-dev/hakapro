"use client";

import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type RowData, type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "@/components/kit/icons";
import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import type { FreshnessMeta } from "@/lib/freshness";
import { useMediaQuery, MEDIA } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCards } from "./table-cards";

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Right-aligned, tabular figures. */
    numeric?: boolean;
    /** Extra classes for header and cells (e.g. a fixed width). */
    className?: string;
  }
}

export type DataTableProps<T> = {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  meta: FreshnessMeta;
  /** Accessible name for the table. */
  caption: string;
  getRowId?: (row: T, index: number) => string;
  initialSorting?: SortingState;
  /** Max height of the scroll area; rows beyond it are virtualized. */
  maxHeight?: number;
  toolbar?: ReactNode;
  empty?: ReactNode;
  testId?: string;
  /** Under 640px render each row as a card (no sideways scroll). Opt in per table; wide numeric tables benefit most. */
  mobile?: "cards";
  /** Hand-built phone card; when omitted the cards are laid out from the columns (see `cardLayout`). */
  renderCard?: (row: T) => ReactNode;
};

/**
 * Sortable, virtualized table (TanStack Table v8 + TanStack Virtual). Rows are measured, so it
 * follows the active density. Freshness of the dataset is shown in the toolbar.
 */
export function DataTable<T>({ columns, data, meta, caption, getRowId, initialSorting = [], maxHeight = 480, toolbar, empty, testId, mobile, renderCard }: DataTableProps<T>) {
  const t = useTranslations("table");
  const phone = useMediaQuery(MEDIA.phone);
  const cards = mobile === "cards" && phone;
  const [sorting, setSorting] = useState<SortingState>(initialSorting);
  // TanStack Table returns non-memoizable functions by design; the React Compiler is off in this project.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId,
  });
  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 40,
    overscan: 12,
  });
  const items = virtualizer.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = items.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;
  const colSpan = table.getVisibleLeafColumns().length;

  return (
    <div data-testid={testId} className="flex flex-col overflow-hidden rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-cell-x py-2">
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          <span className="caption-style num text-subtle" data-testid="row-count">{t("rows", { count: rows.length })}</span>
          <FreshnessBadge {...meta} />
        </div>
      </div>
      {cards && <TableCards table={table} render={renderCard} empty={empty} />}
      {!cards && <div ref={scrollRef} className="overflow-auto" style={{ maxHeight }}>
        <Table aria-label={caption} aria-rowcount={rows.length + 1}>
          <TableHeader sticky>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id} interactive={false}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const numeric = header.column.columnDef.meta?.numeric;
                  return (
                    <TableHead
                      key={header.id}
                      scope="col"
                      numeric={numeric}
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                      className={header.column.columnDef.meta?.className}
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          title={sorted === "asc" ? t("sortDescending") : t("sortAscending")}
                          className={cn("inline-flex items-center gap-1 outline-none hover:text-soft focus-visible:text-foreground", numeric && "flex-row-reverse")}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow interactive={false}>
                <td colSpan={colSpan}>{empty}</td>
              </TableRow>
            )}
            {padTop > 0 && <tr aria-hidden style={{ height: padTop }} />}
            {items.map((item) => {
              const row = rows[item.index];
              return (
                <TableRow key={row.id} ref={virtualizer.measureElement} data-index={item.index} aria-rowindex={item.index + 2} className="h-row">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      numeric={cell.column.columnDef.meta?.numeric}
                      className={cell.column.columnDef.meta?.className}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
            {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }} />}
          </TableBody>
        </Table>
      </div>}
    </div>
  );
}
