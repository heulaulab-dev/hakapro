// IDX historical index backfill (Phase 3): the IDX /primary adapter wired into the EXISTING checkpointed backfill
// infrastructure (schedule/backfill.ts) and the EXISTING index_daily store (db/ingest upsertIndexDaily). No new
// scheduler, cursor store, or table — it is the same date-range, resume-after-interruption, trading-day-aware,
// idempotent machinery the EOD/IHSG backfills already use. One request per WIB trading date (GetIndexSummary is a
// per-date snapshot), newest sessions owned by the daily TradingView job.
//
// Persistence is injectable (`persist`) so the fixture → adapter → validation → backfill → store flow is testable
// without a live transport or a live database. Transport is injected and reports UNAVAILABLE when unauthorized; the
// job then writes nothing (never fabricated rows).
import { type IndexDailyUpsert, type Provenance, upsertIndexDaily } from "../db/ingest";
import type { EngineDb } from "../db/client";
import { backfillJob, BACKFILL_START } from "../schedule/backfill";
import type { JobDefinition } from "../schedule/scheduler";
import { collectIndexSummary, type IdxIndexTransport } from "../sources/idx-primary";
import { wibToday } from "../sources/session";
import type { JobServices, SourceRef } from "./common";

export const IDX_INDEX_BACKFILL_ID = "idx-index-backfill";

export type IdxIndexBackfillOptions = {
  /** First date to backfill (inclusive). Defaults to the shared 2020-01-01 history start. */
  from?: string;
  /** Trading days fetched per night-window run. */
  batchDays?: number;
  /** Cursor revision; changing it deliberately replays this IDX date range from `from`. */
  cursorRevision?: string;
  /** Persistence hook; defaults to the shared upsertIndexDaily. Injected in tests. */
  persist?: (db: EngineDb, rows: IndexDailyUpsert[], prov: Provenance, policy: { primary: boolean }) => Promise<number>;
};

export function idxIndexBackfillJob(services: JobServices, source: SourceRef, transport: IdxIndexTransport, options: IdxIndexBackfillOptions = {}): JobDefinition {
  const persist = options.persist ?? upsertIndexDaily;
  return backfillJob({
    id: IDX_INDEX_BACKFILL_ID,
    sourceId: source.id,
    from: options.from ?? BACKFILL_START,
    batchDays: options.batchDays,
    cursorRevision: options.cursorRevision,
    // The daily TradingView index job owns today and forward; the backfill fills everything strictly before it.
    until: () => wibToday(services.now()),
    async processDay(date) {
      const result = await collectIndexSummary(transport, date);
      if (result.status === "UNAVAILABLE") {
        services.log.info("idx_index_backfill_unavailable", { job: IDX_INDEX_BACKFILL_ID, date, reason: result.reason });
        // Throw before the shared backfill writes its date cursor; a WAF/timeout must be retried next run, not skipped.
        throw new Error(`IDX transport unavailable for ${date}: ${result.reason}`);
      }
      const { rows, rejected } = result.parse;
      if (rejected.length) services.log.info("idx_index_backfill_rejected", { job: IDX_INDEX_BACKFILL_ID, date, rejected: rejected.length });
      if (!rows.length) return { rows: 0 };
      // Secondary provenance: the live TradingView scan stays primary for recent sessions (db/ingest precedence).
      const prov: Provenance = { source: source.id, asOf: services.now(), rawRef: null };
      return { rows: await persist(services.db, rows, prov, { primary: false }) };
    },
  });
}
