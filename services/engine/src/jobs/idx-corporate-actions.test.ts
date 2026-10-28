import { describe, expect, it, vi } from "vitest";
import { MemoryCursorStore } from "../fetch/stores";
import type { JobContext } from "../schedule/scheduler";
import type { IdxFetchResult, IdxJsonTransport } from "../sources/idx-primary";
import fixture from "../sources/fixtures/idx-corporate-actions.json";
import { idxActionsBackfillJob } from "./idx-corporate-actions";

const source = { id: "idx-primary", policy: { minIntervalMs: 2000, concurrency: 1 } };
const services = { db: {} as never, now: () => new Date("2026-10-28T10:00:00Z"), log: { info() {}, warn() {}, error() {} } } as never;
const context = (cursors: MemoryCursorStore, id: string): JobContext => ({ runId: "r", jobId: id, trigger: "schedule", startedAt: new Date(), shouldYield: () => false, cursor: { get: () => cursors.get(id), set: (v) => cursors.set(id, v) }, report: { rows() {}, document() {} } });
const transport = (result: IdxFetchResult): IdxJsonTransport => ({ id: "fixture", async fetchIndexSummary() { return { ok: false, reason: "unused" }; }, async fetchJson() { return result; } });

describe("IDX corporate action backfill", () => {
  it("stores mapped actions and checkpoints only after a complete category", async () => {
    const persist = vi.fn(async (_db: unknown, rows: Array<{ symbol: string; type: string; sourceCategory: string }>) => rows.length);
    const job = idxActionsBackfillJob(services, source, transport({ ok: true, body: fixture }), { categories: ["tanpaHmetd"], persist });
    const cursors = new MemoryCursorStore();
    await job.run(context(cursors, job.id));
    expect(persist.mock.calls[0][1][0]).toMatchObject({ symbol: "UNSP", type: "NON_RIGHTS_ISSUE", sourceCategory: "tanpaHmetd" });
    expect(await cursors.get(job.id)).toMatchObject({ done: ["tanpaHmetd"], from: "idx-actions-v1" });
  });
  it("does not checkpoint an unavailable category", async () => {
    const job = idxActionsBackfillJob(services, source, transport({ ok: false, reason: "timeout" }), { categories: ["tanpaHmetd"] });
    const cursors = new MemoryCursorStore();
    await expect(job.run(context(cursors, job.id))).rejects.toThrow("timeout");
    expect(await cursors.get(job.id)).toBeNull();
  });
});
