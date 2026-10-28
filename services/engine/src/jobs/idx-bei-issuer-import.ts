// Issuer profiles from the private IDX-BEI microservice's company snapshot (classification, board, shareholders,
// subsidiaries). One request to the internal service per run; no external host is contacted and nothing triggers
// the service's own scrapers. Native IDX profiles stay authoritative (db/idx-issuer.ts conflict guard).
import { importIdxBeiIssuerProfiles, securitySymbols } from "../db/idx-issuer";
import type { JobDefinition } from "../schedule/scheduler";
import { IDX_BEI_SOURCE_ID, type IdxBeiApi } from "../sources/idx-bei-api";
import { idxBeiProfiles, type IdxBeiIssuerProfile } from "../sources/idx-bei-companies";
import { withSource, type JobServices } from "./common";
import type { EngineDb } from "../db/client";

export const IDX_BEI_ISSUER_IMPORT_ID = "idx-bei-issuer-import";
/** 07:20 WIB daily: the snapshot changes rarely; one internal read a day keeps it current without load. */
export const IDX_BEI_ISSUER_IMPORT_CRON = "20 7 * * *";
/** A capture time this far ahead of the clock is a corrupt file, not a snapshot. */
const FUTURE_TOLERANCE_MS = 24 * 3_600_000;

export function idxBeiIssuerImportJob(services: JobServices, api: Pick<IdxBeiApi, "companySnapshot">, hooks: {
  known?: (db: EngineDb) => Promise<Set<string>>;
  persist?: (db: EngineDb, rows: IdxBeiIssuerProfile[], provenance: { capturedAt: Date; retrievedAt: Date }) => Promise<number>;
} = {}): JobDefinition {
  const known = hooks.known ?? securitySymbols;
  const persist = hooks.persist ?? importIdxBeiIssuerProfiles;
  return {
    id: IDX_BEI_ISSUER_IMPORT_ID,
    sourceId: IDX_BEI_SOURCE_ID,
    trigger: { kind: "cron", spec: IDX_BEI_ISSUER_IMPORT_CRON },
    async run(ctx) {
      await withSource(services, ctx, IDX_BEI_SOURCE_ID, async () => {
        const read = await api.companySnapshot();
        if (!read.ok) throw new Error(`IDX-BEI company snapshot unavailable: ${read.reason}`);
        const now = services.now();
        if (read.data.last_updated.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) throw new Error("IDX-BEI snapshot capture time is in the future");
        const parsed = idxBeiProfiles(read.data, await known(services.db));
        if (!parsed.rows.length) throw new Error("IDX-BEI snapshot has no company matching the securities directory");
        const changed = await persist(services.db, parsed.rows, { capturedAt: parsed.capturedAt, retrievedAt: now });
        services.log.info("idx_bei_issuer_import", {
          capturedAt: parsed.capturedAt.toISOString(), matched: parsed.rows.length, changed, ...parsed.skipped,
        });
        return { value: null, rows: changed };
      });
    },
  };
}
