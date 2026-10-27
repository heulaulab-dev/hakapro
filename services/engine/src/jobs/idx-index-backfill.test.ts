import { describe, expect, it, vi } from "vitest";
import { MemoryCursorStore } from "../fetch/stores";
import type { JobContext } from "../schedule/scheduler";
import type { IdxFetchResult, IdxIndexTransport } from "../sources/idx-primary";
import { FIXTURE_DATE, IDX_INDEX_SUMMARY_FIXTURE } from "../sources/idx-primary.fixture";
import { unavailableIdxTransport } from "../sources/idx-primary";
import { idxIndexBackfillJob, IDX_INDEX_BACKFILL_ID } from "./idx-index-backfill";
import type { JobServices, SourceRef } from "./common";

const SOURCE: SourceRef = { id: "idx-primary", policy: { minIntervalMs: 2000, concurrency: 1 } };

// Only db/log/now are exercised by the job; the rest of JobServices is irrelevant here.
const services = (now: string): JobServices =>
  ({ db: {} as never, log: { info: () => {}, warn: () => {}, error: () => {} }, now: () => new Date(now) }) as unknown as JobServices;

function context(cursors: MemoryCursorStore, jobId: string): JobContext & { rows: number } {
  const ctx = {
    rows: 0, runId: "r", jobId, trigger: "schedule" as const, startedAt: new Date(), shouldYield: () => false,
    cursor: { get: () => cursors.get(jobId), set: (value: Record<string, unknown>) => cursors.set(jobId, value) },
    report: { document: () => {}, rows: (n: number) => { ctx.rows += n; } },
  };
  return ctx;
}

function fixtureTransport(): IdxIndexTransport {
  return { id: "fixture", async fetchIndexSummary(isoDate): Promise<IdxFetchResult> {
    return isoDate === FIXTURE_DATE ? { ok: true, body: IDX_INDEX_SUMMARY_FIXTURE } : { ok: true, body: { data: [] } };
  } };
}

describe("idxIndexBackfillJob — fixture → adapter → validation → backfill → persist", () => {
  it("persists the validated rows through the shared upsert with secondary provenance", async () => {
    const persist = vi.fn(async (_db: unknown, rows: { code: string }[], _prov: { source: string }, _policy: { primary: boolean }) => rows.length);
    const job = idxIndexBackfillJob(services("2026-01-07T00:00:00Z"), SOURCE, fixtureTransport(), { from: FIXTURE_DATE, batchDays: 1, persist });
    expect(job.id).toBe(IDX_INDEX_BACKFILL_ID);
    expect(job.background).toBe(true); // reuses the existing night-window backfill infrastructure

    const ctx = context(new MemoryCursorStore(), job.id);
    await job.run(ctx);

    expect(persist).toHaveBeenCalledTimes(1);
    const [, rows, prov, policy] = persist.mock.calls[0];
    expect(rows.map((r: { code: string }) => r.code)).toEqual(["COMPOSITE", "IDXENERGY"]); // IDXTECHNO/LQ45 rejected
    expect(policy).toEqual({ primary: false }); // TradingView scan stays primary for recent sessions
    expect(prov.source).toBe("idx-primary");
    expect(ctx.rows).toBe(2);
  });

  it("does not advance the cursor past an unavailable request", async () => {
    const persist = vi.fn(async () => 0);
    const job = idxIndexBackfillJob(services("2026-01-07T00:00:00Z"), SOURCE, unavailableIdxTransport(), { from: FIXTURE_DATE, batchDays: 1, persist });
    const cursors = new MemoryCursorStore();
    const ctx = context(cursors, job.id);
    await expect(job.run(ctx)).rejects.toThrow(/IDX transport unavailable/);
    expect(persist).not.toHaveBeenCalled();
    expect(ctx.rows).toBe(0);
    expect(await cursors.get(job.id)).toBeNull();
  });
});
