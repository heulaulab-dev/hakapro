"use client";

import { flexRender, type Row, type Table } from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useId, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp } from "@/components/kit/icons";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cardLayout, CARD_PAGE, visibleCards } from "@/lib/table-cards";
import { cn } from "@/lib/utils";

/**
 * The phone presentation of a DataTable: one card per row (title, subtitle, label/value pairs) plus a
 * sort control, so no column is ever hidden behind a sideways scroll. `render` replaces the automatic
 * layout when a table wants a hand-built card.
 */
export function TableCards<T>({ table, render, empty }: { table: Table<T>; render?: (row: T) => ReactNode; empty?: ReactNode }) {
  const t = useTranslations("table");
  const sortId = useId();
  const [pages, setPages] = useState(1);
  const rows = table.getRowModel().rows;
  const shown = visibleCards(rows.length, pages);
  const headers = new Map(table.getFlatHeaders().map((header) => [header.column.id, header]));
  const sortable = table.getAllLeafColumns().filter((column) => column.getCanSort());
  const sorted = sortable.find((column) => column.getIsSorted());
  const layout = cardLayout(table.getVisibleLeafColumns().map((column) => ({ id: column.id, numeric: column.columnDef.meta?.numeric })));

  const label = (id: string) => {
    const header = headers.get(id);
    return header ? flexRender(header.column.columnDef.header, header.getContext()) : id;
  };
  const cell = (row: Row<T>, id: string) => {
    const found = row.getVisibleCells().find((item) => item.column.id === id);
    return found ? flexRender(found.column.columnDef.cell, found.getContext()) : null;
  };

  return (
    <div data-testid="table-cards" className="flex flex-col">
      {sortable.length > 0 && (
        <div className="flex items-center gap-2 border-b border-border px-cell-x py-2">
          <label htmlFor={sortId} className="caption-style shrink-0 text-subtle">{t("sortBy")}</label>
          <Select
            value={sorted?.id}
            onValueChange={(id) => {
              const column = table.getColumn(id);
              if (column) column.toggleSorting(column.getFirstSortDir() === "desc");
            }}
          >
            <SelectTrigger id={sortId} className="h-9 min-w-0 flex-1" data-testid="table-cards-sort">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              {sortable.map((column) => (
                <SelectItem key={column.id} value={column.id}>{typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {sorted && (
            <Button
              variant="outline"
              size="icon"
              aria-label={sorted.getIsSorted() === "asc" ? t("sortDescending") : t("sortAscending")}
              onClick={() => sorted.toggleSorting(sorted.getIsSorted() === "asc")}
            >
              {sorted.getIsSorted() === "asc" ? <ArrowUp /> : <ArrowDown />}
            </Button>
          )}
        </div>
      )}
      {rows.length === 0 && empty}
      <ul className="flex flex-col divide-y divide-border">
        {rows.slice(0, shown).map((row) => (
          <li key={row.id} data-testid="table-card" className="px-cell-x py-3">
            {render ? render(row.original) : (
              <div className="flex flex-col gap-2">
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="ticker min-w-0 shrink-0 font-medium">{layout.title && cell(row, layout.title)}</span>
                  {layout.subtitle && <span className="min-w-0 truncate text-right text-muted-foreground">{cell(row, layout.subtitle)}</span>}
                </div>
                {layout.fields.length > 0 && (
                  <dl className={cn("grid gap-x-4 gap-y-1.5", layout.fields.length > 2 ? "grid-cols-3" : "grid-cols-2")}>
                    {layout.fields.map((id) => (
                      <div key={id} className="flex min-w-0 flex-col gap-0.5">
                        <dt className="caption-style truncate text-subtle">{label(id)}</dt>
                        <dd className="ticker text-data break-words">{cell(row, id)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {shown < rows.length && (
        <div className="border-t border-border p-2">
          <Button variant="outline" size="md" className="w-full" onClick={() => setPages((value) => value + 1)}>
            {t("showMore", { count: Math.min(CARD_PAGE, rows.length - shown) })}
          </Button>
        </div>
      )}
    </div>
  );
}
