"use client";

import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable,
  type ColumnDef, type RowData, type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState, type ReactNode } from "react";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import type { FreshnessMeta } from "@/lib/freshness";
import { cn } from "@/lib/utils";

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
};

/**
 * Sortable, virtualized table (TanStack Table v8 + TanStack Virtual). Rows are measured, so it
 * follows the active density. Freshness of the dataset is shown in the toolbar.
 */
export function DataTable<T>({ columns, data, meta, caption, getRowId, initialSorting = [], maxHeight = 480, toolbar, empty, testId }: DataTableProps<T>) {
  const t = useTranslations("table");
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
    <div data-testid={testId} className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-cell-x py-2">
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          <span className="num text-xs text-muted-foreground" data-testid="row-count">{t("rows", { count: rows.length })}</span>
          <FreshnessBadge {...meta} />
        </div>
      </div>
      <div ref={scrollRef} className="overflow-auto" style={{ maxHeight }}>
        <table aria-label={caption} aria-rowcount={rows.length + 1} className="w-full border-separate border-spacing-0 text-data">
          <thead className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  const numeric = header.column.columnDef.meta?.numeric;
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                      className={cn("border-b border-border px-cell-x py-cell-y text-xs font-medium whitespace-nowrap text-muted-foreground", numeric ? "text-right" : "text-left", header.column.columnDef.meta?.className)}
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          title={sorted === "asc" ? t("sortDescending") : t("sortAscending")}
                          className={cn("inline-flex items-center gap-1 hover:text-foreground", numeric && "flex-row-reverse")}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : <ArrowUpDown className="size-3 opacity-40" />}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={colSpan}>{empty}</td>
              </tr>
            )}
            {padTop > 0 && <tr aria-hidden style={{ height: padTop }} />}
            {items.map((item) => {
              const row = rows[item.index];
              return (
                <tr key={row.id} ref={virtualizer.measureElement} data-index={item.index} aria-rowindex={item.index + 2} className="h-row hover:bg-accent/50">
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className={cn("border-b border-border px-cell-x py-cell-y align-middle", cell.column.columnDef.meta?.numeric && "ticker text-right whitespace-nowrap", cell.column.columnDef.meta?.className)}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              );
            })}
            {padBottom > 0 && <tr aria-hidden style={{ height: padBottom }} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
