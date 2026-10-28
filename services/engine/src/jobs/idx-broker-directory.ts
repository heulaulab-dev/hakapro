// Full IDX exchange-member directory refresh. Incomplete snapshots never overwrite a complete registry.
import type { EngineDb } from "../db/client";
import type { Provenance } from "../db/ingest";
import { upsertIdxBrokerMembers } from "../db/idx-broker";
import type { JobDefinition } from "../schedule/scheduler";
import { fetchIdxBrokerDirectory, parseIdxBrokerDirectory, type IdxBrokerMember } from "../sources/idx-broker-directory";
import type { IdxJsonTransport } from "../sources/idx-primary";
import type { JobServices, SourceRef } from "./common";

export const IDX_BROKER_DIRECTORY_JOB_ID = "idx-broker-directory";

export function idxBrokerDirectoryJob(
  services: JobServices,
  source: SourceRef,
  transport: IdxJsonTransport,
  hooks: { persist?: (db: EngineDb, snapshot: { rows: IdxBrokerMember[]; complete: boolean }, provenance: Provenance) => Promise<number> } = {},
): JobDefinition {
  return {
    id: IDX_BROKER_DIRECTORY_JOB_ID, sourceId: source.id,
    trigger: { kind: "cron", spec: "0 17 * * 1-5", tradingDaysOnly: true },
    async run(ctx) {
      if (ctx.shouldYield()) return { status: "YIELDED" };
      const fetched = await fetchIdxBrokerDirectory(transport);
      if (!fetched.ok) throw new Error(`IDX broker directory unavailable: ${fetched.reason}`);
      const parsed = parseIdxBrokerDirectory(fetched.body);
      if (!parsed.complete) throw new Error(`IDX broker directory snapshot incomplete: ${parsed.rows.length}/${parsed.total ?? "unknown"}; rejected=${parsed.rejected}`);
      const rows = await (hooks.persist ?? upsertIdxBrokerMembers)(services.db, parsed, { source: source.id, asOf: services.now(), rawRef: null });
      ctx.report.rows(rows);
      return { status: "SUCCEEDED" };
    },
  };
}
