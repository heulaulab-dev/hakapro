import { describe, expect, it, vi } from "vitest";
import { MemoryCursorStore } from "../fetch/stores";
import type { JobContext } from "../schedule/scheduler";
import type { IdxFetchResult, IdxJsonTransport } from "../sources/idx-primary";
import fixture from "../sources/fixtures/idx-financial-ratios.2024-Q2.json";
import { idxRatiosBackfillJob, idxRatioPeriods, IDX_RATIOS_JOB_ID } from "./idx-ratios";

const source = { id: "idx-primary", policy: { minIntervalMs: 2000, concurrency: 1 } };
const services = { db: {} as never, now: () => new Date("2026-10-28T10:00:00Z"), log: { info() {}, warn() {}, error() {} } } as never;
const context = (cursors: MemoryCursorStore, id: string): JobContext => ({ runId: "r", jobId: id, trigger: "schedule", startedAt: new Date(), shouldYield: () => false, cursor: { get: () => cursors.get(id), set: (v) => cursors.set(id, v) }, report: { rows() {}, document() {} } });
function transport(result: IdxFetchResult): IdxJsonTransport { return { id: "fixture", async fetchIndexSummary() { return { ok: false, reason: "unused" }; }, async fetchJson() { return result; } }; }

describe("idxRatiosBackfillJob", () => {
  it("enumerates fiscal periods and persists original plus screener representations", async () => {
    expect(idxRatioPeriods(2024, 2024)).toEqual(["2024:annual:4", "2024:quarterly:1", "2024:quarterly:2", "2024:quarterly:3", "2024:quarterly:4"]);
    const persistPeriods = vi.fn(async (_db: unknown, rows: Array<{ symbol: string; metrics: Record<string, number | null> }>) => rows.length);
    const persistLatest = vi.fn(async (_db: unknown, rows: Array<{ symbol: string }>) => rows.length * 6);
    const job = idxRatiosBackfillJob(services, source, transport({ ok: true, body: fixture }), { fromYear: 2024, throughYear: 2024, batchSize: 1, items: ["2024:quarterly:2"], persistPeriods, persistLatest });
    const cursors = new MemoryCursorStore();
    await job.run(context(cursors, job.id));
    expect(job.id).toBe(IDX_RATIOS_JOB_ID);
    expect(persistPeriods.mock.calls[0][1][0]).toMatchObject({ symbol: "AADI", metrics: { roe: 47.318 } });
    expect(persistLatest).toHaveBeenCalledOnce();
    expect(await cursors.get(job.id)).toMatchObject({ done: ["2024:quarterly:2"], from: "idx-ratios-v1" });
  });
  it("does not checkpoint a period after a transport error", async () => {
    const job = idxRatiosBackfillJob(services, source, transport({ ok: false, reason: "upstream unavailable" }), { fromYear: 2024, throughYear: 2024, batchSize: 1, items: ["2024:quarterly:2"] });
    const cursors = new MemoryCursorStore();
    await expect(job.run(context(cursors, job.id))).rejects.toThrow("unavailable");
    expect(await cursors.get(job.id)).toBeNull();
  });

  it("does not treat an empty page as terminal when the source reports rows remain", async () => {
    const job = idxRatiosBackfillJob(services, source, transport({ ok: true, body: { totalRecords: 101, data: [] } }), {
      fromYear: 2024, throughYear: 2024, batchSize: 1, items: ["2024:quarterly:2"],
    });
    const cursors = new MemoryCursorStore();

    await expect(job.run(context(cursors, job.id))).rejects.toThrow(/empty page.*101 records/);
    expect(await cursors.get(job.id)).toBeNull();
  });

  it("does not checkpoint a short page while the reported total requires another page", async () => {
    const job = idxRatiosBackfillJob(services, source, transport({ ok: true, body: { totalRecords: 101, data: [{ code: "AAA", fsDate: "2024-06-30" }] } }), {
      fromYear: 2024, throughYear: 2024, batchSize: 1, items: ["2024:quarterly:2"],
      persistPeriods: async (_db, rows) => rows.length, persistLatest: async () => 0,
    });
    const cursors = new MemoryCursorStore();

    await expect(job.run(context(cursors, job.id))).rejects.toThrow(/short page.*101 records/);
    expect(await cursors.get(job.id)).toBeNull();
  });
});
