import { describe, expect, it, vi } from "vitest";
import type { SecurityUpsert } from "../db/ingest";
import fixture from "../sources/fixtures/idx-company-profile.2026-08-07.json";
import detailFixture from "../sources/fixtures/idx-company-detail.2026-08-07.json";
import type { IdxJsonTransport } from "../sources/idx-primary";
import type { JobContext } from "../schedule/scheduler";
import { idxCompanyDetailJob, idxCompanyProfilesJob } from "./idx-company";

const source = { id: "idx-primary", policy: { minIntervalMs: 2000, concurrency: 1 } };
const services = { db: {} as never, now: () => new Date("2026-10-28T10:00:00Z"), log: { info() {}, warn: vi.fn(), error() {} } } as never;
function context(jobId: string, cursorStore?: Map<string, Record<string, unknown>>): JobContext { return { runId: "r", jobId, trigger: "schedule", startedAt: new Date(), shouldYield: () => false, cursor: { get: async () => cursorStore?.get(jobId) ?? null, set: async (v) => { cursorStore?.set(jobId, v); } }, report: { rows() {}, document() {} } }; }
function transport(body: unknown): IdxJsonTransport { return { id: "fixture", async fetchIndexSummary() { return { ok: false, reason: "unused" }; }, async fetchJson() { return { ok: true, body }; } }; }

describe("idxCompanyProfilesJob", () => {
  it("upserts the mapped directory but never deactivates on a partial response", async () => {
    const persist = vi.fn(async (_db: unknown, rows: SecurityUpsert[]) => rows.length);
    const deactivate = vi.fn(async () => 0);
    const job = idxCompanyProfilesJob(services, source, transport(fixture), { persist, deactivate });
    await job.run(context(job.id));
    expect(persist.mock.calls[0][1][0]).toMatchObject({ symbol: "AADI", board: "Utama", listingDate: "2024-12-05" });
    expect(deactivate).not.toHaveBeenCalled();
  });
  it("deactivates missing symbols only after a verified complete directory response", async () => {
    const complete = { recordsTotal: 1, recordsFiltered: 1, data: [{ KodeEmiten: "AADI", NamaEmiten: "AADI" }] };
    const deactivate = vi.fn(async () => 1);
    const job = idxCompanyProfilesJob(services, source, transport(complete), { persist: async () => 1, deactivate });
    await job.run(context(job.id));
    expect(deactivate).toHaveBeenCalledWith(expect.anything(), ["AADI"]);
  });
  it("checkpoints issuer details and persists only parsed source data", async () => {
    const cursors = new Map<string, Record<string, unknown>>();
    const persist = vi.fn(async (_db: unknown, _row: { symbol: string; profile: Record<string, unknown> }) => {});
    const job = idxCompanyDetailJob(services, source, transport(detailFixture), { items: async () => ["AADI"], persist: persist as never });
    await job.run(context(job.id, cursors));
    expect(persist).toHaveBeenCalledOnce();
    expect(persist.mock.calls[0][1]).toMatchObject({ symbol: "AADI", profile: { Website: "www.adaroindonesia.com" } });
    expect(cursors.get(job.id)).toMatchObject({ done: ["AADI"], from: "issuer-detail-v1" });
  });
});
