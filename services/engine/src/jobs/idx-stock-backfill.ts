// Daily IDX GetStockSummary backfill using the shared date cursor and daily_prices store.
// IDX rows are a secondary OHLC source and a source-owned foreign-flow source, so existing Yahoo OHLC remains primary.
import { type DailyUpsert, type Provenance, upsertDaily } from "../db/ingest";
import type { EngineDb } from "../db/client";
import { backfillJob, BACKFILL_START } from "../schedule/backfill";
import type { JobDefinition } from "../schedule/scheduler";
import type { IdxJsonTransport } from "../sources/idx-primary";
import { fetchIdxStockSummary, parseIdxStockSummary } from "../sources/idx-stock-summary";
import { wibToday } from "../sources/session";
import type { JobServices, SourceRef } from "./common";

export const IDX_STOCK_BACKFILL_ID = "idx-stock-backfill";

export type IdxStockBackfillOptions = {
  from?: string;
  batchDays?: number;
  cursorRevision?: string;
  persist?: (db: EngineDb, rows: DailyUpsert[], prov: Provenance, policy: { primary: boolean; value: "fill"; foreign: true }) => Promise<number>;
};

export function idxStockBackfillJob(services: JobServices, source: SourceRef, transport: IdxJsonTransport, options: IdxStockBackfillOptions = {}): JobDefinition {
  const persist = options.persist ?? upsertDaily;
  return backfillJob({
    id: IDX_STOCK_BACKFILL_ID,
    sourceId: source.id,
    from: options.from ?? BACKFILL_START,
    batchDays: options.batchDays,
    cursorRevision: options.cursorRevision,
    until: () => wibToday(services.now()),
    async processDay(date) {
      const fetched = await fetchIdxStockSummary(transport, date);
      if (!fetched.ok) {
        services.log.info("idx_stock_backfill_unavailable", { job: IDX_STOCK_BACKFILL_ID, date, reason: fetched.reason });
        throw new Error(`IDX stock transport unavailable for ${date}: ${fetched.reason}`);
      }
      const { rows, rejected } = parseIdxStockSummary(fetched.body, date);
      if (rejected.length) services.log.info("idx_stock_backfill_rejected", { job: IDX_STOCK_BACKFILL_ID, date, rejected: rejected.length });
      if (!rows.length) throw new Error(`IDX stock response had no valid rows for ${date}; refusing to advance the backfill cursor`);
      const provenance: Provenance = { source: source.id, asOf: services.now(), rawRef: null };
      return { rows: await persist(services.db, rows, provenance, { primary: false, value: "fill", foreign: true }) };
    },
  });
}
