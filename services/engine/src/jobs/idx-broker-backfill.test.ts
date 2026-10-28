import { describe, expect, it, vi } from "vitest";
import { MemoryCursorStore } from "../fetch/stores";
import type { JobContext } from "../schedule/scheduler";
import type { IdxFetchResult, IdxJsonTransport } from "../sources/idx-primary";
import fixture from "../sources/fixtures/idx-broker-summary.2026-08-07.json";
import { idxBrokerBackfillJob } from "./idx-broker-backfill";

const date = "2026-08-07";
const source = { id: "idx-primary", policy: { minIntervalMs: 2000, concurrency: 1 } };
const services = { db: {} as never, log: { info() {}, warn() {}, error() {} }, now: () => new Date("2026-08-10T12:00:00Z") } as never;
const ctx = (cursors: MemoryCursorStore, jobId: string): JobContext => ({
  runId: "r", jobId, trigger: "schedule", startedAt: new Date(), shouldYield: () => false,
  cursor: { get: () => cursors.get(jobId), set: (v) => cursors.set(jobId, v) }, report: { rows() {}, document() {} },
});
const transport = (result: IdxFetchResult): IdxJsonTransport => ({
  id: "test", async fetchIndexSummary() { return { ok: false, reason: "unused" }; }, async fetchJson() { return result; },
});

describe("idxBrokerBackfillJob", () => {
  it("persists date×broker fixture rows through the shared cursor", async () => {
    const persist = vi.fn(async (_db: unknown, rows: Array<{ brokerCode: string }>) => rows.length);
    const job = idxBrokerBackfillJob(services, source, transport({ ok: true, body: fixture }), { from: date, batchDays: 1, cursorRevision: "r2", persist });
    const cursors = new MemoryCursorStore();
    await job.run(ctx(cursors, job.id));
    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0][1][0]).toMatchObject({ date, brokerCode: "AD", value: 4351965300 });
    expect(await cursors.get(job.id)).toMatchObject({ updatedFor: `${date}:r2` });
  });

  it("does not advance the cursor for unavailable or empty responses", async () => {
    for (const result of [{ ok: false as const, reason: "unavailable" }, { ok: true as const, body: { data: [] } }]) {
      const persist = vi.fn(async () => 0);
      const job = idxBrokerBackfillJob(services, source, transport(result), { from: date, batchDays: 1, persist });
      const cursors = new MemoryCursorStore();
      await expect(job.run(ctx(cursors, job.id))).rejects.toThrow();
      expect(persist).not.toHaveBeenCalled();
      expect(await cursors.get(job.id)).toBeNull();
    }
  });
});
