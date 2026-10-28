// IDX source-period ratios retain fiscal metadata and original units; compatible latest values also feed the screener.
import { sql } from "drizzle-orm";
import * as t from "../../db/schema";
import type { EngineDb } from "./client";
import type { Provenance } from "./ingest";
import { toIdxStockRatios, type IdxRatioPeriod } from "../sources/idx-ratios";

export async function upsertIdxRatioPeriods(db: EngineDb, rows: IdxRatioPeriod[], provenance: Provenance): Promise<number> {
  for (const row of rows) {
    await db.insert(t.idxRatioPeriods).values({ ...row, source: provenance.source, asOf: provenance.asOf, rawRef: provenance.rawRef }).onConflictDoUpdate({
      target: [t.idxRatioPeriods.symbol, t.idxRatioPeriods.fsDate, t.idxRatioPeriods.periodType],
      set: {
        fiscalYearEnd: sql`excluded."fiscal_year_end"`, sharia: sql`excluded."sharia"`, audit: sql`excluded."audit"`, opinion: sql`excluded."opinion"`,
        metrics: sql`excluded."metrics"`, source: sql`excluded."source"`, asOf: sql`excluded."as_of"`, rawRef: sql`excluded."raw_ref"`,
      },
    });
  }
  return rows.length;
}

/** Store latest API-facing ratios using IDX as a separate provider; period table keeps the full history. */
export async function upsertIdxStockRatios(db: EngineDb, rows: IdxRatioPeriod[], provenance: Provenance): Promise<number> {
  const values = rows.flatMap((row) => toIdxStockRatios(row).map((ratio) => ({
    symbol: row.symbol, ratio: ratio.ratio, ratioSource: "idx" as const, value: ratio.value, date: row.fsDate,
    basis: ratio.basis, note: ratio.value === null ? "NON_POSITIVE_SOURCE_VALUE" : null, inputs: ratio.inputs, derivation: null,
    computedAt: provenance.asOf, source: provenance.source, asOf: provenance.asOf, rawRef: provenance.rawRef,
  })));
  if (!values.length) return 0;
  await db.insert(t.stockRatios).values(values).onConflictDoUpdate({
    target: [t.stockRatios.symbol, t.stockRatios.ratio, t.stockRatios.ratioSource],
    set: {
      value: sql`excluded."value"`, date: sql`excluded."date"`, basis: sql`excluded."basis"`, note: sql`excluded."note"`,
      inputs: sql`excluded."inputs"`, derivation: sql`excluded."derivation"`, computedAt: sql`excluded."computed_at"`,
      source: sql`excluded."source"`, asOf: sql`excluded."as_of"`, rawRef: sql`excluded."raw_ref"`,
    },
  });
  return values.length;
}
