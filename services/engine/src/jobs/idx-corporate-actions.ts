// One-time historical corporate-action import by the 15 source categories, using the shared resumable item cursor.
import type { EngineDb } from "../db/client";
import { upsertIdxActions } from "../db/idx-disclosures";
import type { Provenance } from "../db/ingest";
import { itemBackfillJob } from "../schedule/backfill";
import type { JobDefinition } from "../schedule/scheduler";
import { fetchIdxActions, IDX_CA_TYPES, parseIdxActions } from "../sources/idx-disclosures";
import type { IdxJsonTransport } from "../sources/idx-primary";
import type { JobServices, SourceRef } from "./common";

export const IDX_ACTIONS_BACKFILL_ID = "idx-actions-backfill";
const PAGE_SIZE = 9999;
export function idxActionsBackfillJob(
  services: JobServices,
  source: SourceRef,
  transport: IdxJsonTransport,
  hooks: { categories?: string[]; persist?: (db: EngineDb, rows: Array<{ symbol: string; type: string; sourceCategory: string; exDate: string; shares: number | null; sharesAfter: number | null; description: string }>, provenance: Provenance) => Promise<number>; batchSize?: number } = {},
): JobDefinition {
  const persist = hooks.persist ?? upsertIdxActions;
  return itemBackfillJob({
    id: IDX_ACTIONS_BACKFILL_ID, sourceId: source.id, from: "idx-actions-v1", batchSize: hooks.batchSize ?? 2,
    items: async () => hooks.categories ?? [...IDX_CA_TYPES],
    async processItem(category) {
      let start = 0;
      let total: number | null = null;
      let written = 0;
      while (start <= (total ?? 0)) {
        const fetched = await fetchIdxActions(transport, category, start);
        if (!fetched.ok) throw new Error(`IDX corporate action ${category} unavailable at offset ${start}: ${fetched.reason}`);
        const parsed = parseIdxActions(fetched.body, category, start);
        if (parsed.total === null) throw new Error(`IDX corporate action ${category} page omitted total count`);
        total = parsed.total;
        if (parsed.rows.length) written += await persist(services.db, parsed.rows, { source: source.id, asOf: services.now(), rawRef: null });
        if (parsed.complete) break;
        if (!parsed.rows.length || parsed.rows.length < PAGE_SIZE) throw new Error(`IDX corporate action ${category} ended before its reported total ${total}`);
        start += PAGE_SIZE;
      }
      return { rows: written };
    },
  });
}
