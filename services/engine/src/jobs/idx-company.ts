// IDX listed-company universe refresh. Incomplete responses never deactivate existing securities.
import { activeSymbols, deactivateMissing, upsertSecurities } from "../db/ingest";
import { upsertIdxIssuerProfile } from "../db/idx-issuer";
import type { EngineDb } from "../db/client";
import type { Provenance } from "../db/ingest";
import type { SecurityUpsert } from "../db/ingest";
import type { JobDefinition } from "../schedule/scheduler";
import { itemBackfillJob } from "../schedule/backfill";
import { fetchIdxCompanyDetail, fetchIdxCompanyProfiles, parseIdxCompanyDetail, parseIdxCompanyProfiles } from "../sources/idx-company";
import type { IdxJsonTransport } from "../sources/idx-primary";
import type { JobServices, SourceRef } from "./common";

export const IDX_COMPANY_PROFILES_JOB_ID = "idx-company-profiles";
export function idxCompanyProfilesJob(
  services: JobServices,
  source: SourceRef,
  transport: IdxJsonTransport,
  hooks: {
    persist?: (db: EngineDb, rows: SecurityUpsert[], provenance: Provenance) => Promise<number>;
    deactivate?: (db: EngineDb, symbols: string[]) => Promise<number>;
  } = {},
): JobDefinition {
  const persist = hooks.persist ?? upsertSecurities;
  const deactivate = hooks.deactivate ?? deactivateMissing;
  return {
    id: IDX_COMPANY_PROFILES_JOB_ID, sourceId: source.id,
    trigger: { kind: "cron", spec: "0 17 * * 1-5", tradingDaysOnly: true },
    async run(ctx) {
      const fetched = await fetchIdxCompanyProfiles(transport);
      if (!fetched.ok) throw new Error(`IDX company directory unavailable: ${fetched.reason}`);
      const parsed = parseIdxCompanyProfiles(fetched.body);
      if (!parsed.rows.length) throw new Error("IDX company directory has no valid securities");
      const written = await persist(services.db, parsed.rows, { source: source.id, asOf: services.now(), rawRef: null });
      if (parsed.complete) await deactivate(services.db, parsed.rows.map((row) => row.symbol));
      else services.log.warn("idx_company_directory_incomplete", { rows: parsed.rows.length });
      ctx.report.rows(written);
      return { status: "SUCCEEDED" };
    },
  };
}

export const IDX_COMPANY_DETAIL_JOB_ID = "idx-company-detail";
export function idxCompanyDetailJob(
  services: JobServices,
  source: SourceRef,
  transport: IdxJsonTransport,
  hooks: {
    items?: () => Promise<string[]>;
    persist?: typeof upsertIdxIssuerProfile;
  } = {},
): JobDefinition {
  const items = hooks.items ?? (() => activeSymbols(services.db));
  const persist = hooks.persist ?? upsertIdxIssuerProfile;
  return itemBackfillJob({
    id: IDX_COMPANY_DETAIL_JOB_ID, sourceId: source.id, from: "issuer-detail-v1", batchSize: 15,
    items,
    async processItem(symbol) {
      const fetched = await fetchIdxCompanyDetail(transport, symbol);
      if (!fetched.ok) throw new Error(`IDX company detail unavailable for ${symbol}: ${fetched.reason}`);
      const profile = parseIdxCompanyDetail(fetched.body, symbol);
      await persist(services.db, profile, { source: source.id, asOf: services.now(), rawRef: null });
      return { rows: 1 };
    },
  });
}
