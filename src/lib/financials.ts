import type { StatementRow } from "@/components/data/statement-table";

/** Drops line items that are zero/missing in every period and have no non-empty descendants. */
export function pruneEmptyRows<T extends StatementRow>(rows: T[]): T[] {
  const hasData = (row: T) => row.values.some((value) => value !== null && value !== 0);
  const keep = new Set<string>();
  for (const row of rows) {
    if (!hasData(row)) continue;
    const parts = row.key.split(".");
    for (let index = 1; index <= parts.length; index += 1) keep.add(parts.slice(0, index).join("."));
  }
  return rows.filter((row) => keep.has(row.key));
}
