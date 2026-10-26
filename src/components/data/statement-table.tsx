"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useLocale } from "next-intl";
import { useMemo, useState } from "react";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import type { FreshnessMeta } from "@/lib/freshness";
import { formatIdr, type Locale } from "@/lib/format";
import { cn } from "@/lib/utils";

export type StatementRow = { key: string; label: string; depth: number; expandable: boolean; values: Array<number | null> };

/**
 * Hierarchical financial statement: line items × periods. Parent rows expand to their children;
 * the label column stays pinned while periods scroll horizontally. Missing values show "—".
 */
export function StatementTable({ rows, periods, meta, caption, selectedKey, onSelect }: {
  rows: StatementRow[];
  periods: string[];
  meta: FreshnessMeta;
  caption: string;
  selectedKey?: string | null;
  onSelect?: (row: StatementRow) => void;
}) {
  const locale = useLocale() as Locale;
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const visible = useMemo(() => rows.filter((row) => {
    const parts = row.key.split(".");
    for (let index = 1; index < parts.length; index += 1) if (!expanded.has(parts.slice(0, index).join("."))) return false;
    return true;
  }), [rows, expanded]);
  const toggle = (key: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border" data-testid="statement-table">
      <div className="flex items-center justify-end border-b border-border px-cell-x py-2"><FreshnessBadge {...meta} /></div>
      <div className="overflow-x-auto">
        <table aria-label={caption} className="w-full border-separate border-spacing-0 text-data">
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-10 min-w-40 max-w-44 border-b sm:min-w-56 sm:max-w-none border-border bg-card px-cell-x py-cell-y text-left text-xs font-medium text-muted-foreground">{caption}</th>
              {periods.map((period) => <th key={period} scope="col" className="border-b border-border px-cell-x py-cell-y text-right text-xs font-medium whitespace-nowrap text-muted-foreground">{period}</th>)}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.key} data-key={row.key} className={cn("h-row hover:bg-accent/40", selectedKey === row.key && "bg-accent/60")} aria-selected={selectedKey === row.key || undefined}>
                <th scope="row" className={cn("sticky left-0 z-10 border-b border-border bg-card px-cell-x py-cell-y text-left font-normal", row.depth === 0 && "font-medium")}>
                  <span className="flex items-center gap-1" style={{ paddingLeft: row.depth * 16 }}>
                    {row.expandable ? (
                      <button type="button" onClick={() => toggle(row.key)} aria-expanded={expanded.has(row.key)} aria-label={row.label} className="rounded-sm text-muted-foreground hover:text-foreground">
                        {expanded.has(row.key) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </button>
                    ) : <span className="w-3.5" />}
                    {onSelect && !row.expandable ? (
                      <button type="button" onClick={() => onSelect(row)} className="text-left hover:underline max-sm:line-clamp-2 sm:truncate">{row.label}</button>
                    ) : <span className="max-sm:line-clamp-2 sm:truncate">{row.label}</span>}
                  </span>
                </th>
                {row.values.map((value, index) => (
                  <td key={index} className="ticker border-b border-border px-cell-x py-cell-y text-right whitespace-nowrap">{row.expandable && value === null ? "" : formatIdr(value, locale, { compact: true })}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
