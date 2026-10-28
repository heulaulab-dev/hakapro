import { describe, expect, it, vi } from "vitest";
import newsFixture from "../sources/fixtures/idx-news-search.json";
import announcementFixture from "../sources/fixtures/idx-announcements.json";
import actionFixture from "../sources/fixtures/idx-corporate-actions.json";
import type { IdxJsonTransport } from "../sources/idx-primary";
import type { JobContext } from "../schedule/scheduler";
import { idxDisclosuresSyncJob } from "./idx-disclosures-sync";

const source = { id: "idx-primary", policy: { minIntervalMs: 2000, concurrency: 1 } };
const services = { db: {} as never, now: () => new Date("2026-10-28T10:00:00Z"), log: { info() {}, warn() {}, error() {} } } as never;
const context = (jobId: string): JobContext => ({ runId: "r", jobId, trigger: "schedule", startedAt: new Date(), shouldYield: () => false, cursor: { get: async () => null, set: async () => {} }, report: { rows() {}, document() {} } });
const transport: IdxJsonTransport = { id: "fixture", async fetchIndexSummary() { return { ok: false, reason: "unused" }; }, async fetchJson(path) {
  if (path.includes("GetNewsSearch")) return { ok: true, body: newsFixture };
  if (path.includes("GetAllAnnouncement")) return { ok: true, body: announcementFixture };
  return { ok: true, body: actionFixture };
} };

describe("IDX recurring disclosure sync", () => {
  it("persists headlines, official attachment metadata, and recent mapped actions", async () => {
    const persistNews = vi.fn(async (_db: unknown, rows: Array<{ outlet: string }>) => rows.length);
    const persistAnnouncements = vi.fn(async (_db: unknown, rows: Array<{ documentUrl: string | null }>) => rows.length);
    const persistActions = vi.fn(async (_db: unknown, rows: Array<{ sourceCategory: string; shares: number | null }>) => rows.length);
    const job = idxDisclosuresSyncJob(services, source, transport, {
      categories: ["tanpaHmetd"], knownSymbols: async () => new Set(["ASPR"]), persistNews, persistAnnouncements, persistActions,
    });
    await job.run(context(job.id));
    expect(persistNews.mock.calls[0][1][0]).toMatchObject({ outlet: "IDX", symbols: ["ASPR"] });
    expect(persistAnnouncements.mock.calls[0][1][0].documentUrl).toMatch(/^https:\/\/www\.idx\.co\.id\//);
    expect(persistActions.mock.calls[0][1][0]).toMatchObject({ sourceCategory: "tanpaHmetd", shares: 14505112734 });
  });

  it("reads every reported news page instead of silently truncating after five", async () => {
    const newsPages: number[] = [];
    const paginatedTransport: IdxJsonTransport = {
      ...transport,
      async fetchJson(path, params) {
        if (path.includes("GetNewsSearch")) {
          const page = Number(params.pageNumber);
          newsPages.push(page);
          return {
            ok: true,
            body: {
              total: 600,
              data: Array.from({ length: 100 }, (_, index) => {
                const id = `${page}-${index}`;
                return {
                  Id: id,
                  PublishedDate: "2026-10-27T09:00:00",
                  Title: `Market update ${id}`,
                  Summary: "IDX market update",
                  Links: [{ Rel: "self", Href: `https://www.idx.co.id/news/${id}` }],
                };
              }),
            },
          };
        }
        return transport.fetchJson(path, params);
      },
    };
    const persistNews = vi.fn(async (_db: unknown, rows: Array<unknown>) => rows.length);
    const job = idxDisclosuresSyncJob(services, source, paginatedTransport, {
      categories: ["tanpaHmetd"], knownSymbols: async () => new Set(), persistNews,
      persistAnnouncements: async () => 0, persistActions: async () => 0,
    });

    await job.run(context(job.id));

    expect(newsPages).toEqual([1, 2, 3, 4, 5, 6]);
    expect(persistNews).toHaveBeenCalledTimes(6);
  });
});
