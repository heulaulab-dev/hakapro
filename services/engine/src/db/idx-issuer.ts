// IDX profile snapshots are source-specific corporate disclosures, never KSEI ownership snapshots.
import { and, eq, sql } from "drizzle-orm";
import * as t from "../../db/schema";
import type { EngineDb } from "./client";
import type { IdxIssuerProfile } from "../sources/idx-company";
import type { IdxBeiIssuerProfile } from "../sources/idx-bei-companies";
import { IDX_BEI_SOURCE_ID } from "../sources/idx-bei-api";

export type IdxIssuerProfileRecord = IdxIssuerProfile & { retrievedAt: Date; source: string; asOf: Date };

export async function upsertIdxIssuerProfile(db: EngineDb, row: IdxIssuerProfile, provenance: { source: string; asOf: Date; rawRef: string | null }) {
  await db.insert(t.idxIssuerProfiles).values({ ...row, retrievedAt: provenance.asOf, ...provenance }).onConflictDoUpdate({
    target: [t.idxIssuerProfiles.symbol, t.idxIssuerProfiles.language],
    set: {
      profile: sql`excluded."profile"`, directors: sql`excluded."directors"`, commissioners: sql`excluded."commissioners"`,
      auditCommittee: sql`excluded."audit_committee"`, shareholders: sql`excluded."shareholders"`, subsidiaries: sql`excluded."subsidiaries"`,
      retrievedAt: sql`excluded."retrieved_at"`, source: sql`excluded."source"`, asOf: sql`excluded."as_of"`, rawRef: sql`excluded."raw_ref"`,
    },
  });
}

const IMPORT_CHUNK = 200;

/**
 * Imports IDX-BEI snapshot profiles in one transaction. Rows the native IDX job wrote stay authoritative: the
 * conflict update only touches rows this source wrote itself, and only when the snapshot is not older. Returns
 * the rows actually inserted or changed, so re-importing the same snapshot reports 0 changes after the first run.
 * `as_of` is the snapshot's capture time and `retrieved_at` when the engine read it.
 */
export async function importIdxBeiIssuerProfiles(db: EngineDb, rows: IdxBeiIssuerProfile[], provenance: { capturedAt: Date; retrievedAt: Date }): Promise<number> {
  if (!rows.length) return 0;
  return db.transaction(async (tx) => {
    let changed = 0;
    for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
      const batch = rows.slice(i, i + IMPORT_CHUNK);
      const written = await tx.insert(t.idxIssuerProfiles)
        .values(batch.map((row) => ({ ...row, retrievedAt: provenance.retrievedAt, source: IDX_BEI_SOURCE_ID, asOf: provenance.capturedAt, rawRef: null })))
        .onConflictDoUpdate({
          target: [t.idxIssuerProfiles.symbol, t.idxIssuerProfiles.language],
          set: {
            profile: sql`excluded."profile"`, directors: sql`excluded."directors"`, commissioners: sql`excluded."commissioners"`,
            shareholders: sql`excluded."shareholders"`, subsidiaries: sql`excluded."subsidiaries"`,
            retrievedAt: sql`excluded."retrieved_at"`, asOf: sql`excluded."as_of"`,
          },
          // Never replace a native IDX row; never move an IDX-BEI row back to an older snapshot; skip unchanged rows.
          setWhere: sql`${t.idxIssuerProfiles.source} = ${IDX_BEI_SOURCE_ID} and ${t.idxIssuerProfiles.asOf} <= excluded."as_of"
            and (${t.idxIssuerProfiles.asOf} < excluded."as_of" or ${t.idxIssuerProfiles.profile} is distinct from excluded."profile"
              or ${t.idxIssuerProfiles.directors} is distinct from excluded."directors" or ${t.idxIssuerProfiles.commissioners} is distinct from excluded."commissioners"
              or ${t.idxIssuerProfiles.shareholders} is distinct from excluded."shareholders" or ${t.idxIssuerProfiles.subsidiaries} is distinct from excluded."subsidiaries")`,
        })
        .returning({ symbol: t.idxIssuerProfiles.symbol });
      changed += written.length;
    }
    return changed;
  });
}

/** Every symbol in the securities directory (issuer profiles reference it). */
export async function securitySymbols(db: EngineDb): Promise<Set<string>> {
  const rows = await db.select({ symbol: t.securities.symbol }).from(t.securities);
  return new Set(rows.map((row) => row.symbol));
}

export async function getIdxIssuerProfile(db: EngineDb, symbol: string, language = "id-id"): Promise<IdxIssuerProfileRecord | null> {
  const [row] = await db.select().from(t.idxIssuerProfiles).where(and(eq(t.idxIssuerProfiles.symbol, symbol), eq(t.idxIssuerProfiles.language, language))).limit(1);
  return row ?? null;
}
