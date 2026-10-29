// Ownership routes (E6) on SYNTHETIC uploads: admin auth, size limit, dedupe, parsing outcome, and the /v1 contracts.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { idxBeiEnvelope } from "@/server/schemas/idx-bei";
import { ownershipChangesSchema, ownershipUploadSchema, stockOwnershipSchema } from "@/server/schemas/ownership";
import { tempDir } from "../../test/support";
import { LocalRawStore } from "../fetch/raw-store";
import { MemoryCursorStore, MemoryRawDocumentIndex, MemoryRunRecorder, MemorySourceStateStore } from "../fetch/stores";
import { OwnershipService } from "../ownership/service";
import { MemoryOwnershipStore } from "../ownership/store";
import { PauseGuard } from "../schedule/pause";
import { Scheduler } from "../schedule/scheduler";
import { createApp, type AppDeps } from "./app";

const BASE = "http://engine.test";
const ADMIN = { authorization: "Bearer admin-token" };
const committed = (name: string) => new Uint8Array(readFileSync(new URL(`../../test/fixtures/ownership/${name}`, import.meta.url)));

describe("ownership routes", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  let disk = 40;

  beforeEach(async () => { dir = await tempDir(); disk = 40; });
  afterEach(async () => { await dir.cleanup(); });

  function app(options: { freeFloatEnabled?: boolean; ownershipNetworkEnabled?: boolean; maxUploadBytes?: number; overrides?: Partial<AppDeps> } = {}) {
    const pause = new PauseGuard(dir.path, 85, { cacheMs: 0, measure: async () => disk });
    const scheduler = new Scheduler({ jobs: [], pause, runs: new MemoryRunRecorder(), cursors: new MemoryCursorStore(), sourceState: new MemorySourceStateStore() });
    const store = new MemoryOwnershipStore();
    const service = new OwnershipService({ store, rawStore: new LocalRawStore(`${dir.path}/raw`), documents: new MemoryRawDocumentIndex(), now: () => new Date("2026-10-16T08:00:00Z") });
    const handler = createApp({
      adminToken: "admin-token", ping: async () => true, pause, scheduler, rawStoreKind: "local", sourceHealth: async () => [], unblockSource: async () => false,
      now: () => new Date("2026-10-16T09:00:00Z"),
      ownership: { service, maxUploadBytes: options.maxUploadBytes ?? 20 * 1024 * 1024, freeFloatEnabled: options.freeFloatEnabled ?? false },
      intelligence: { catalysts: false, breadth: false, ownershipNetwork: options.ownershipNetworkEnabled ?? false },
      ...options.overrides,
    });
    const call = (path: string, init?: RequestInit) => handler(new Request(`${BASE}${path}`, init));
    const upload = (file: Uint8Array, query: string, type = "application/pdf") =>
      call(`/v1/admin/ownership/upload?${query}`, { method: "POST", headers: { ...ADMIN, "content-type": type }, body: file });
    return { call, upload, store };
  }

  it("requires the admin token and is disabled without one", async () => {
    const { call } = app();
    const body = committed("synthetic-1pct-2026-02.pdf");
    expect((await call("/v1/admin/ownership/upload?asOf=2026-02", { method: "POST", body })).status).toBe(401);
    expect((await call("/v1/admin/ownership/upload?asOf=2026-02", { method: "POST", body, headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await call("/v1/admin/ownership/uploads")).status).toBe(401);
    const disabled = app({ overrides: { adminToken: undefined } });
    expect((await disabled.call("/v1/admin/ownership/upload?asOf=2026-02", { method: "POST", body, headers: ADMIN })).status).toBe(404);
  });

  it("accepts a raw PDF body, parses it and lists the upload", async () => {
    const { upload, call } = app();
    const response = await upload(committed("synthetic-1pct-2026-02.pdf"), "asOf=2026-02&source=SYNTHETIC%20announcement%20001&filename=../../ksei-feb.pdf");
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as { data: unknown };
    expect(ownershipUploadSchema.parse(data)).toMatchObject({ status: "PARSED", asOfMonth: "2026-02", snapshotDate: "2026-02-27", fileName: "ksei-feb.pdf", sourceLabel: "SYNTHETIC announcement 001", format: "pdf" });

    const list = await call("/v1/admin/ownership/uploads", { headers: ADMIN });
    expect(list.status).toBe(200);
    const listed = ownershipUploadSchema.array().parse(((await list.json()) as { data: unknown }).data);
    expect(listed).toHaveLength(1);
    expect(listed[0].stats).toMatchObject({ rowsAccepted: 9, issuers: 3 });
    expect((await call("/v1/admin/ownership/uploads?limit=0", { headers: ADMIN })).status).toBe(400);
    expect((await call("/v1/admin/ownership/uploads", { method: "POST", headers: ADMIN })).status).toBe(405);
  });

  it("accepts multipart with the parameters as form fields", async () => {
    const { call } = app();
    const form = new FormData();
    form.set("file", new Blob([committed("synthetic-1pct-2026-03.csv")], { type: "text/csv" }), "march.csv");
    form.set("asOf", "2026-03");
    const response = await call("/v1/admin/ownership/upload", { method: "POST", headers: ADMIN, body: form });
    expect(response.status).toBe(201);
    const { data } = (await response.json()) as { data: { format: string; fileName: string; issues: unknown[] } };
    expect(data).toMatchObject({ format: "csv", fileName: "march.csv" });
    expect(data.issues).toHaveLength(1);
    const empty = new FormData();
    empty.set("asOf", "2026-03");
    expect((await call("/v1/admin/ownership/upload", { method: "POST", headers: ADMIN, body: empty })).status).toBe(400);
  });

  it("validates asOf, source and snapshotDate", async () => {
    const { upload } = app();
    const file = committed("synthetic-1pct-2026-02.pdf");
    expect((await upload(file, "")).status).toBe(400);
    expect((await upload(file, "asOf=2026-2")).status).toBe(400);
    expect((await upload(file, "asOf=2026-13")).status).toBe(400);
    expect((await upload(file, "asOf=2026-11")).status).toBe(400); // future month
    expect((await upload(file, "asOf=2026-02&snapshotDate=2026-03-01")).status).toBe(400);
    expect((await upload(file, "asOf=2026-02&snapshotDate=2026-02-30")).status).toBe(400);
    expect((await upload(file, `asOf=2026-02&source=${"x".repeat(201)}`)).status).toBe(400);
    expect((await upload(new Uint8Array(), "asOf=2026-02")).status).toBe(400);
  });

  it("enforces the size limit from Content-Length and from the streamed body", async () => {
    const { upload, call } = app({ maxUploadBytes: 1024 });
    const big = new Uint8Array(4096).fill(0x41);
    const declared = await upload(big, "asOf=2026-02", "text/csv");
    expect(declared.status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (let i = 0; i < 4; i += 1) controller.enqueue(new Uint8Array(512).fill(0x41)); controller.close(); } });
    const streamed = await call("/v1/admin/ownership/upload?asOf=2026-02", { method: "POST", headers: { ...ADMIN, "content-type": "text/csv" }, body: stream, duplex: "half" } as RequestInit);
    expect(streamed.status).toBe(413);
  });

  it("deduplicates by sha256 and refuses the same file for another month", async () => {
    const { upload } = app();
    const file = committed("synthetic-1pct-2026-02.pdf");
    const first = (await (await upload(file, "asOf=2026-02")).json()) as { data: { id: string } };
    const again = await upload(file, "asOf=2026-02");
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ duplicate: true, data: { id: first.data.id } });
    const other = await upload(file, "asOf=2026-01");
    expect(other.status).toBe(409);
    expect(await other.json()).toMatchObject({ error: { code: "CONFLICT" }, data: { id: first.data.id } });
  });

  it("answers 415 for other files, 422 with the error for an unparseable one, and 503 under the disk guard", async () => {
    const { upload } = app();
    expect((await upload(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0]), "asOf=2026-02", "image/png")).status).toBe(415);
    const bad = await upload(new TextEncoder().encode("a;b\n1;2\n"), "asOf=2026-02", "text/csv");
    expect(bad.status).toBe(422);
    expect(await bad.json()).toMatchObject({ error: { code: "PARSE_FAILED" }, data: { status: "FAILED", error: expect.stringContaining("No header row") } });
    disk = 90;
    expect((await upload(committed("synthetic-1pct-2026-02.pdf"), "asOf=2026-02")).status).toBe(503);
  });

  it("re-parses an upload by id", async () => {
    const { upload, call } = app();
    const { data } = (await (await upload(committed("synthetic-1pct-2026-02.pdf"), "asOf=2026-02")).json()) as { data: { id: string } };
    const reparsed = await call(`/v1/admin/ownership/uploads/${data.id}/reparse`, { method: "POST", headers: ADMIN });
    expect(reparsed.status).toBe(200);
    expect(await reparsed.json()).toMatchObject({ data: { id: data.id, status: "PARSED" } });
    expect((await call("/v1/admin/ownership/uploads/not-a-uuid/reparse", { method: "POST", headers: ADMIN })).status).toBe(400);
    expect((await call("/v1/admin/ownership/uploads/00000000-0000-4000-8000-000000000000/reparse", { method: "POST", headers: ADMIN })).status).toBe(404);
  });

  it("serves the latest month per stock and the month's changes on the shared contracts", async () => {
    const { upload, call } = app();
    await upload(committed("synthetic-1pct-2026-02.pdf"), "asOf=2026-02&source=SYNTHETIC%20Feb");
    await upload(committed("synthetic-1pct-2026-03.pdf"), "asOf=2026-03&source=SYNTHETIC%20Mar");

    const stock = idxBeiEnvelope(stockOwnershipSchema).parse(await (await call("/v1/stocks/test1/ownership")).json());
    expect(stock.meta).toMatchObject({ source: "hakapro-engine", dataAsOf: "2026-03-31", freshness: "HISTORICAL" });
    expect(stock.data).toMatchObject({
      symbol: "TEST1", issuerName: "PT CONTOH DUMMY TBK", month: "2026-03", snapshotDate: "2026-03-31", thresholdPercent: "1.000000",
      source: { dataset: "ksei-1pct-manual-upload", reference: "SYNTHETIC Mar", retrievedAt: "2026-10-16T08:00:00.000Z" },
      comparison: { status: "COMPARED", fromMonth: "2026-02", counts: { INCREASE: 1, NEW: 1, BELOW_THRESHOLD: 1, UNCHANGED: 3 } },
      freeFloat: null,
    });
    expect(stock.data.holders.map((holder) => [holder.holderName, holder.shares, holder.percent])).toEqual([
      ["PT CONTOH INDUK FIKTIF", "610000000", "61.000000"],
      ["DUMMY CUSTODIAN BANK SINGAPORE BRANCH S/A CONTOH CLIENT ACCOUNT", "64000000", "6.400000"],
      ["NEGARA REPUBLIK INDONESIA", "31000000", "3.100000"],
      ["BUDI CONTOH", "20000000", "2.000000"],
      ["ANDI CONTOH", "11000000", "1.100000"],
    ]);
    // TEST3 is only in February: its latest month is served as such.
    const test3 = idxBeiEnvelope(stockOwnershipSchema).parse(await (await call("/v1/stocks/TEST3/ownership")).json());
    expect(test3.data).toMatchObject({ month: "2026-02", comparison: { status: "NO_PREVIOUS" } });

    const changes = idxBeiEnvelope(ownershipChangesSchema).parse(await (await call("/v1/ownership/changes?month=2026-03")).json());
    expect(changes.meta).toMatchObject({ dataAsOf: "2026-03-31", freshness: "HISTORICAL" });
    expect(changes.data.previousMonth).toBe("2026-02");
    expect(changes.data.comparisons.map((comparison) => [comparison.symbol, comparison.status])).toEqual([["TEST1", "COMPARED"], ["TEST2", "COMPARED"], ["TEST4", "NO_PREVIOUS"]]);
    expect(changes.data.changes).toHaveLength(9);
    // Without month: the newest stored month.
    const latest = idxBeiEnvelope(ownershipChangesSchema).parse(await (await call("/v1/ownership/changes")).json());
    expect(latest.data).toMatchObject({ month: "2026-03", previousMonth: "2026-02" });
    expect(latest.data.changes).toHaveLength(9);
    const filtered = idxBeiEnvelope(ownershipChangesSchema).parse(await (await call("/v1/ownership/changes?month=2026-03&symbol=test2")).json());
    expect(filtered.data.changes.map((change) => [change.holderName, change.kind])).toEqual([
      // Ordered by holder key: "name:SITI CONTOH", "org:DANA PENSIUN CONTOH", "org:FIKTIF HOLDCO".
      ["SITI CONTOH", "UNCHANGED"], ["DANA PENSIUN CONTOH", "UNCHANGED"], ["PT FIKTIF HOLDCO", "DECREASE"],
    ]);
  });

  it("serves the free-float draft only with ENGINE_FREE_FLOAT_ENABLED", async () => {
    const { upload, call } = app({ freeFloatEnabled: true });
    await upload(committed("synthetic-1pct-2026-03.pdf"), "asOf=2026-03");
    const stock = idxBeiEnvelope(stockOwnershipSchema).parse(await (await call("/v1/stocks/TEST1/ownership")).json());
    expect(stock.data.freeFloat).toMatchObject({ methodologyStatus: "draft", figureType: "ESTIMATE", isOfficial: false, estimate: { headline: "26.400000" } });
  });

  it("serves an exact-match ownership network only when enabled", async () => {
    const { upload, call } = app({ ownershipNetworkEnabled: true });
    await upload(committed("synthetic-1pct-2026-02.pdf"), "asOf=2026-02");
    const stock = idxBeiEnvelope(stockOwnershipSchema).parse(await (await call("/v1/stocks/TEST1/ownership")).json());
    expect(stock.data.network).toMatchObject({ nodes: expect.any(Array), edges: expect.any(Array), ambiguous: expect.any(Number) });
    expect(stock.data.network?.edges.every((edge) => edge.confidence === "exact")).toBe(true);
  });

  it("answers with empty forms when nothing is stored, and validates parameters", async () => {
    const { call } = app();
    const empty = idxBeiEnvelope(stockOwnershipSchema).parse(await (await call("/v1/stocks/TEST9/ownership")).json());
    expect(empty).toMatchObject({ data: { symbol: "TEST9", month: null, holders: [], freeFloat: null }, meta: { freshness: "UNAVAILABLE", dataAsOf: null } });
    const none = idxBeiEnvelope(ownershipChangesSchema).parse(await (await call("/v1/ownership/changes?month=2026-01")).json());
    expect(none).toMatchObject({ data: { month: "2026-01", previousMonth: "2025-12", comparisons: [], changes: [] }, meta: { freshness: "UNAVAILABLE" } });
    // No month and nothing stored: this month's empty form (the market-wide feed before the first upload).
    const latestNone = idxBeiEnvelope(ownershipChangesSchema).parse(await (await call("/v1/ownership/changes")).json());
    expect(latestNone).toMatchObject({ data: { comparisons: [], changes: [] }, meta: { freshness: "UNAVAILABLE" } });
    expect((await call("/v1/ownership/changes?month=2026-1")).status).toBe(400);
    expect((await call("/v1/ownership/changes?month=2026-01&symbol=bad$")).status).toBe(400);
    expect((await call("/v1/stocks/bad$/ownership")).status).toBe(400);
    const without = app({ overrides: { ownership: undefined } });
    expect((await without.call("/v1/stocks/TEST1/ownership")).status).toBe(200);
    expect((await without.call("/v1/admin/ownership/uploads", { headers: ADMIN })).status).toBe(404);
  });
});
