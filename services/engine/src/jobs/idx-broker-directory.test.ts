import { describe, expect, it, vi } from "vitest";
import fixture from "../sources/fixtures/idx-broker-directory.2026-08-07.json";
import type { IdxJsonTransport } from "../sources/idx-primary";
import type { JobContext } from "../schedule/scheduler";
import { idxBrokerDirectoryJob } from "./idx-broker-directory";

const source = { id: "idx-primary", policy: { minIntervalMs: 2000, concurrency: 1 } };
const services = { db: {} as never, now: () => new Date("2026-10-28T10:00:00Z"), log: { info() {}, warn() {}, error() {} } } as never;
const context = (id: string): JobContext => ({ runId: "r", jobId: id, trigger: "schedule", startedAt: new Date(), shouldYield: () => false, cursor: { get: async () => null, set: async () => {} }, report: { rows() {}, document() {} } });
const transport = (body: unknown): IdxJsonTransport => ({ id: "fixture", async fetchIndexSummary() { return { ok: false, reason: "unused" }; }, async fetchJson() { return { ok: true, body }; } });

describe("IDX broker directory job", () => {
  it("persists a complete directory snapshot", async () => {
    const persist = vi.fn(async (_db: unknown, snapshot: { rows: unknown[] }) => snapshot.rows.length);
    const job = idxBrokerDirectoryJob(services, source, transport({ recordsTotal: 1, data: [{ Code: "XC", Name: "Ajaib", License: "Broker" }] }), { persist });
    await job.run(context(job.id));
    expect(persist.mock.calls[0][1]).toMatchObject({ complete: true, rows: [{ code: "XC", name: "Ajaib", license: "Broker" }] });
  });

  it("does not replace the stored directory with a reduced fixture", async () => {
    const persist = vi.fn(async () => 0);
    const job = idxBrokerDirectoryJob(services, source, transport(fixture), { persist });
    await expect(job.run(context(job.id))).rejects.toThrow(/snapshot incomplete: 3\/90/);
    expect(persist).not.toHaveBeenCalled();
  });
});
