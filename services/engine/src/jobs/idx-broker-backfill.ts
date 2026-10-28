// Market-wide IDX GetBrokerSummary history shares the existing resumable backfill scheduler.
import type { EngineDb } from "../db/client";
import { upsertIdxBrokerDaily } from "../db/idx-broker";
import type { Provenance } from "../db/ingest";
import { backfillJob, BACKFILL_START } from "../schedule/backfill";
import type { JobDefinition } from "../schedule/scheduler";
import type { IdxJsonTransport } from "../sources/idx-primary";
import { fetchIdxBrokerSummary, parseIdxBrokerSummary, type IdxBrokerDailyUpsert } from "../sources/idx-broker-summary";
import { wibToday } from "../sources/session";
import type { JobServices, SourceRef } from "./common";

export const IDX_BROKER_BACKFILL_ID = "idx-broker-backfill";
export type IdxBrokerBackfillOptions = {
  from?: string; batchDays?: number; cursorRevision?: string;
  persist?: (db: EngineDb, rows: IdxBrokerDailyUpsert[], provenance: Provenance) => Promise<number>;
};

export function idxBrokerBackfillJob(services: JobServices, source: SourceRef, transport: IdxJsonTransport, options: IdxBrokerBackfillOptions = {}): JobDefinition {
  const persist = options.persist ?? upsertIdxBrokerDaily;
  return backfillJob({
    id: IDX_BROKER_BACKFILL_ID, sourceId: source.id, from: options.from ?? BACKFILL_START,
    batchDays: options.batchDays, cursorRevision: options.cursorRevision, until: () => wibToday(services.now()),
    async processDay(date) {
      const fetched = await fetchIdxBrokerSummary(transport, date);
      if (!fetched.ok) throw new Error(`IDX broker summary unavailable for ${date}: ${fetched.reason}`);
      const { rows, rejected } = parseIdxBrokerSummary(fetched.body, date);
      if (rejected.length) services.log.info("idx_broker_backfill_rejected", { job: IDX_BROKER_BACKFILL_ID, date, rejected: rejected.length });
      if (!rows.length) throw new Error(`IDX broker response had no valid rows for ${date}; refusing to advance cursor`);
      return { rows: await persist(services.db, rows, { source: source.id, asOf: services.now(), rawRef: null }) };
    },
  });
}
