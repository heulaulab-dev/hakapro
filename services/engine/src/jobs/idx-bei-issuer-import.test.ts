import { describe, expect, it, vi } from "vitest";
import { MemoryCursorStore, MemorySourceStateStore } from "../fetch/stores";
import type { JobContext } from "../schedule/scheduler";
import { IDX_BEI_SOURCE_ID, type IdxBeiRead } from "../sources/idx-bei-api";
import { idxBeiCompanySnapshotSchema, type IdxBeiCompanySnapshot, type IdxBeiIssuerProfile } from "../sources/idx-bei-companies";
import snapshotFixture from "../sources/fixtures/idx-bei-company-snapshot.2026-08-26.json";
import { idxBeiIssuerImportJob, IDX_BEI_ISSUER_IMPORT_ID } from "./idx-bei-issuer-import";
import type { JobServices } from "./common";

const NOW = "2026-10-28T07:30:00Z";
const services = (sourceState: MemorySourceStateStore): JobServices =>
  ({ db: {} as never, sourceState, log: { info: () => {}, warn: () => {}, error: () => {} }, now: () => new Date(NOW) }) as unknown as JobServices;

function context(jobId: string): JobContext & { rows: number } {
  const cursors = new MemoryCursorStore();
  const ctx = {
    rows: 0, runId: "r", jobId, trigger: "schedule" as const, startedAt: new Date(), shouldYield: () => false,
    cursor: { get: () => cursors.get(jobId), set: (value: Record<string, unknown>) => cursors.set(jobId, value) },
    report: { document: () => {}, rows: (n: number) => { ctx.rows += n; } },
  };
  return ctx;
}

const api = (read: IdxBeiRead<IdxBeiCompanySnapshot>) => ({ companySnapshot: async () => read });
const known = async () => new Set(["BBCA", "TLKM", "EMAS"]);

describe("idxBeiIssuerImportJob — IDX-BEI snapshot → validation → normalization → persistence", () => {
  it("persists the matched profiles with the snapshot's capture time as provenance", async () => {
    const state = new MemorySourceStateStore();
    const persist = vi.fn(async (_db: unknown, rows: IdxBeiIssuerProfile[], _provenance: { capturedAt: Date; retrievedAt: Date }) => rows.length);
    const job = idxBeiIssuerImportJob(services(state), api({ ok: true, data: idxBeiCompanySnapshotSchema.parse(snapshotFixture) }), { known, persist });
    expect(job.id).toBe(IDX_BEI_ISSUER_IMPORT_ID);
    expect(job.sourceId).toBe(IDX_BEI_SOURCE_ID);

    const ctx = context(job.id);
    await job.run(ctx);

    const [, rows, provenance] = persist.mock.calls[0];
    expect(rows.map((row) => row.symbol)).toEqual(["BBCA", "TLKM", "EMAS"]);
    expect(provenance.capturedAt.toISOString()).toBe("2026-08-26T10:31:48.000Z");
    expect(provenance.retrievedAt.toISOString()).toBe("2026-10-28T07:30:00.000Z");
    expect(ctx.rows).toBe(3);
    expect(state.state.get(IDX_BEI_SOURCE_ID)?.lastSuccessAt).not.toBeNull();
  });

  it("fails visibly and records the source error when IDX-BEI is unavailable; nothing is written", async () => {
    const state = new MemorySourceStateStore();
    const persist = vi.fn(async () => 0);
    const job = idxBeiIssuerImportJob(services(state), api({ ok: false, reason: "circuit-open" }), { known, persist });
    await expect(job.run(context(job.id))).rejects.toThrow("IDX-BEI company snapshot unavailable: circuit-open");
    expect(persist).not.toHaveBeenCalled();
    expect(state.state.get(IDX_BEI_SOURCE_ID)?.lastError).toContain("circuit-open");
  });

  it("rejects a snapshot dated in the future", async () => {
    const future = idxBeiCompanySnapshotSchema.parse({ ...snapshotFixture, last_updated: "2027-01-01 00:00:00" });
    const persist = vi.fn(async () => 0);
    const job = idxBeiIssuerImportJob(services(new MemorySourceStateStore()), api({ ok: true, data: future }), { known, persist });
    await expect(job.run(context(job.id))).rejects.toThrow("in the future");
    expect(persist).not.toHaveBeenCalled();
  });

  it("refuses to import when no company matches the securities directory", async () => {
    const persist = vi.fn(async () => 0);
    const job = idxBeiIssuerImportJob(services(new MemorySourceStateStore()), api({ ok: true, data: idxBeiCompanySnapshotSchema.parse(snapshotFixture) }), { known: async () => new Set(), persist });
    await expect(job.run(context(job.id))).rejects.toThrow("no company matching");
    expect(persist).not.toHaveBeenCalled();
  });
});
