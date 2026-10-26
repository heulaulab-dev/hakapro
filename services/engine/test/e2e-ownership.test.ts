// E6 ownership uploads end to end against a throwaway PostgreSQL (Docker): admin upload → raw store + raw_documents →
// ownership_uploads → snapshot sets/rows → HAKA-33 changes → /v1 routes, with the real migrations. SYNTHETIC files
// only (fake tickers TEST1…TEST4); nothing is fetched from anywhere. Opt-in (`bun run engine:test:e2e`).
import { readFileSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { idxBeiEnvelope, radarSchema, stealthOwnershipSchema } from "@/server/schemas/idx-bei";
import { ownershipChangesSchema, ownershipUploadSchema, stockOwnershipSchema } from "@/server/schemas/ownership";
import * as t from "../db/schema";
import { loadConfig } from "../src/config";
import { createEngine } from "../src/engine";
import { nullLogger } from "../src/log";
import { syntheticOwnershipXlsx, MAR_2026 } from "./ownership-fixtures";
import { dockerEnabled, startPostgres, type TestPostgres } from "./postgres";
import { tempDir } from "./support";

const enabled = dockerEnabled();
const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/ownership/${name}`, import.meta.url)));
const ADMIN = { authorization: "Bearer e2e-admin" };

describe.skipIf(!enabled)("ownership uploads (docker postgres)", () => {
  let pg: TestPostgres;
  const cleanups: Array<() => Promise<void>> = [];
  let counter = 0;

  beforeAll(async () => { pg = await startPostgres(); }, 120_000);
  afterAll(async () => {
    for (const cleanup of cleanups) await cleanup();
    pg?.stop();
  });

  async function harness(env: Record<string, string> = {}) {
    const url = await pg.createDatabase(`ownership_${++counter}`);
    const dir = await tempDir("engine-ownership-");
    const config = loadConfig({ ENGINE_DATABASE_URL: url, ENGINE_DATA_DIR: dir.path, ENGINE_ADMIN_TOKEN: "e2e-admin", ENGINE_DISK_STOP_PERCENT: "100", ...env });
    // No sources or jobs: the ownership path never fetches anything.
    const engine = await createEngine(config, { registry: () => ({ sources: [], jobs: [] }), log: nullLogger, now: () => new Date("2026-10-16T08:00:00Z") });
    cleanups.push(async () => { await engine.shutdown(); await dir.cleanup(); });
    const call = (path: string, init?: RequestInit) => engine.app(new Request(`http://engine.test${path}`, init));
    const upload = (body: Uint8Array, query: string, type = "application/pdf") =>
      call(`/v1/admin/ownership/upload?${query}`, { method: "POST", headers: { ...ADMIN, "content-type": type }, body });
    return { engine, call, upload, db: engine.services.db };
  }

  it("uploads two months, stores sets with provenance and serves changes", async () => {
    const { upload, call, db, engine } = await harness();
    const feb = await upload(fixture("synthetic-1pct-2026-02.pdf"), "asOf=2026-02&source=SYNTHETIC%20Feb&filename=feb.pdf");
    expect(feb.status).toBe(201);
    const mar = await upload(fixture("synthetic-1pct-2026-03.pdf"), "asOf=2026-03&source=SYNTHETIC%20Mar&filename=mar.pdf");
    expect(mar.status).toBe(201);
    const marBody = ownershipUploadSchema.parse(((await mar.json()) as { data: unknown }).data);
    expect(marBody).toMatchObject({ status: "PARSED", snapshotDate: "2026-03-31", stats: { rowsAccepted: 10, rowsRejected: 1, changes: 9 } });
    expect(marBody.issues.filter((issue) => issue.severity === "error").map((issue) => issue.locator)).toEqual(["p2.l3", "p2.l3"]);

    // Raw copy, indexed and marked parsed; the manual source shows up with its rows.
    const docs = await db.select().from(t.rawDocuments).orderBy(asc(t.rawDocuments.fetchedAt));
    expect(docs).toHaveLength(2);
    expect(docs.every((doc) => doc.source === "ownership-upload" && doc.parseStatus === "PARSED" && doc.contentType === "application/pdf")).toBe(true);
    expect(Buffer.from((await engine.services.rawStore.get(docs[0].r2Key))!).equals(Buffer.from(fixture("synthetic-1pct-2026-02.pdf")))).toBe(true);
    const [source] = await db.select().from(t.sources).where(eq(t.sources.id, "ownership-upload"));
    expect(source).toMatchObject({ host: "admin-upload", status: "OK", rowsIngested: 19 });

    // Sets and rows: numeric(24,0) / numeric(9,6) come back as exact strings; the duplicate published line is kept.
    const sets = await db.select().from(t.ownershipSnapshotSets).orderBy(asc(t.ownershipSnapshotSets.month), asc(t.ownershipSnapshotSets.symbol));
    expect(sets.map((set) => [set.symbol, set.month, set.snapshotDate, set.rowCount])).toEqual([
      ["TEST1", "2026-02", "2026-02-27", 5], ["TEST2", "2026-02", "2026-02-27", 3], ["TEST3", "2026-02", "2026-02-27", 1],
      ["TEST1", "2026-03", "2026-03-31", 5], ["TEST2", "2026-03", "2026-03-31", 4], ["TEST4", "2026-03", "2026-03-31", 1],
    ]);
    expect(sets[0]).toMatchObject({ dataset: "ksei-1pct-manual-upload", thresholdPercent: "1.000000", sourceReference: "SYNTHETIC Feb", rawRef: docs[0].id });
    const siti = await db.select().from(t.ownershipSnapshotRows).where(eq(t.ownershipSnapshotRows.holderKey, "name:SITI CONTOH"));
    expect(siti.map((row) => [row.shares, row.percent])).toEqual([["12000000", "1.200000"], ["12000000", "1.200000"], ["12000000", "1.200000"]]);

    const changes = idxBeiEnvelope(ownershipChangesSchema).parse(await (await call("/v1/ownership/changes?month=2026-03")).json());
    expect(changes.meta).toMatchObject({ freshness: "HISTORICAL", dataAsOf: "2026-03-31" });
    expect(changes.data.changes.map((change) => [change.symbol, change.holderName, change.kind, change.shareDelta, change.ppDelta])).toEqual([
      ["TEST1", "ANDI CONTOH", "NEW", null, null],
      ["TEST1", "BUDI CONTOH", "UNCHANGED", "0", "0.000000"],
      ["TEST1", "PT CONTOH INDUK FIKTIF", "INCREASE", "10000000", "1.000000"],
      ["TEST1", "DUMMY CUSTODIAN BANK SINGAPORE BRANCH S/A CONTOH CLIENT ACCOUNT", "UNCHANGED", "0", "0.000000"],
      ["TEST1", "NEGARA REPUBLIK INDONESIA", "UNCHANGED", "0", "0.000000"],
      ["TEST1", "REKSA DANA CONTOH SAHAM", "BELOW_THRESHOLD", null, null],
      ["TEST2", "SITI CONTOH", "UNCHANGED", "0", "0.000000"],
      ["TEST2", "DANA PENSIUN CONTOH", "UNCHANGED", "0", "0.000000"],
      ["TEST2", "PT FIKTIF HOLDCO", "DECREASE", "-10000000", "-1.000000"],
    ]);
    expect(changes.data.comparisons.map((comparison) => [comparison.symbol, comparison.status])).toEqual([["TEST1", "COMPARED"], ["TEST2", "COMPARED"], ["TEST4", "NO_PREVIOUS"]]);

    const stock = idxBeiEnvelope(stockOwnershipSchema).parse(await (await call("/v1/stocks/TEST1/ownership")).json());
    expect(stock.data).toMatchObject({ month: "2026-03", snapshotDate: "2026-03-31", freeFloat: null, source: { reference: "SYNTHETIC Mar" } });
    expect(stock.data.holders[0]).toMatchObject({ holderName: "PT CONTOH INDUK FIKTIF", shares: "610000000", percent: "61.000000", investorType: "CP", localForeign: "L" });

    const list = ownershipUploadSchema.array().parse(((await (await call("/v1/admin/ownership/uploads", { headers: ADMIN })).json()) as { data: unknown }).data);
    expect(list.map((item) => [item.asOfMonth, item.status, item.fileName])).toEqual([["2026-03", "PARSED", "mar.pdf"], ["2026-02", "PARSED", "feb.pdf"]]);

    // Corporate-holder view and the radar's KSEI signal, read through the PostgreSQL stores. Synthetic closes: TEST1 is
    // flat between the position dates (the 2026-03-31 close is two days before the date, still within the gap).
    const asOf = new Date("2026-03-31T10:00:00Z");
    const bar = (date: string, close: number, volume: number) => ({
      symbol: "TEST1", date, close, previousClose: close, volume, value: 1000 * close, frequency: 100, source: "test-fixture", asOf,
    });
    const dates = Array.from({ length: 21 }, (_, index) => `2026-03-${String(index + 9).padStart(2, "0")}`);
    await db.insert(t.securities).values({ symbol: "TEST1", name: "PT CONTOH DUMMY TBK", sector: "Finance", active: true, source: "test-fixture", asOf });
    await db.insert(t.dailyPrices).values([bar("2026-02-26", 500, 1000), ...dates.map((date, index) => bar(date, 500, index === dates.length - 1 ? 3000 : 1000))]);
    const stealth = idxBeiEnvelope(stealthOwnershipSchema).parse(await (await call("/v1/ownership/stealth")).json());
    expect(stealth.meta).toMatchObject({ freshness: "HISTORICAL", dataAsOf: "2026-03-31" });
    expect(stealth.data.stocks.map((stock) => [stock.symbol, stock.combinedShareDelta, stock.price?.from.date, stock.price?.to.date, stock.price?.changePercent])).toEqual([
      ["TEST1", "10000000", "2026-02-26", "2026-03-29", 0],
    ]);
    expect(stealth.data.stocks[0].holders.map((holder) => [holder.holderName, holder.investorType, holder.kind])).toEqual([["PT CONTOH INDUK FIKTIF", "CP", "INCREASE"]]);

    const radar = idxBeiEnvelope(radarSchema).parse(await (await call("/v1/radar")).json());
    expect(radar.data).toMatchObject({ tradingDate: "2026-03-29", kseiMonth: "2026-03", coverage: { stocks: 1, listed: 1 } });
    expect(radar.data.stocks[0].fired.map((signal) => [signal.key, signal.observed])).toEqual([["volumeSpike", 3], ["kseiHolderIncrease", 1]]);
    expect(radar.data.stocks[0].status).toMatchObject({ foreignNetBuy5: "missing", orderSizeSpike: "ok", kseiHolderIncrease: "ok" });
  });

  it("deduplicates, replaces a month on a corrected upload, re-parses, and records failures", async () => {
    const { upload, call, db } = await harness({ ENGINE_FREE_FLOAT_ENABLED: "1" });
    expect((await upload(fixture("synthetic-1pct-2026-02.pdf"), "asOf=2026-02")).status).toBe(201);
    expect((await upload(fixture("synthetic-1pct-2026-03.pdf"), "asOf=2026-03")).status).toBe(201);
    const duplicate = await upload(fixture("synthetic-1pct-2026-03.pdf"), "asOf=2026-03");
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ duplicate: true });
    expect((await upload(fixture("synthetic-1pct-2026-03.pdf"), "asOf=2026-02")).status).toBe(409);

    // A corrected March file (XLSX export) replaces March; changes follow the new rows.
    const xlsx = syntheticOwnershipXlsx({ ...MAR_2026, isoDate: "2026-03-31" });
    const corrected = await upload(xlsx, "asOf=2026-03&filename=march.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(corrected.status).toBe(201);
    const correctedBody = (await corrected.json()) as { data: { id: string; format: string; stats: { setsReplaced: number } } };
    expect(correctedBody.data).toMatchObject({ format: "xlsx", stats: { setsReplaced: 3 } });
    const march = await db.select().from(t.ownershipSnapshotSets).where(eq(t.ownershipSnapshotSets.month, "2026-03"));
    expect(march).toHaveLength(3);
    expect(march.every((set) => set.uploadId === correctedBody.data.id)).toBe(true);
    expect(await db.select().from(t.ownershipChanges).where(eq(t.ownershipChanges.month, "2026-03"))).toHaveLength(9);
    const [rawXlsx] = await db.select().from(t.rawDocuments).where(eq(t.rawDocuments.contentType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
    expect(rawXlsx.r2Key).toMatch(/\.xlsx$/);

    const reparse = await call(`/v1/admin/ownership/uploads/${correctedBody.data.id}/reparse`, { method: "POST", headers: ADMIN });
    expect(reparse.status).toBe(200);
    expect(await db.select().from(t.ownershipChanges).where(eq(t.ownershipChanges.month, "2026-03"))).toHaveLength(9);

    // The draft estimate is served only because ENGINE_FREE_FLOAT_ENABLED=1 here.
    const stock = idxBeiEnvelope(stockOwnershipSchema).parse(await (await call("/v1/stocks/TEST1/ownership")).json());
    expect(stock.data.freeFloat).toMatchObject({ methodologyStatus: "draft", isOfficial: false, estimate: { headline: "26.400000", high: "35.900000" } });

    const failed = await upload(new TextEncoder().encode("no;header\n1;2\n"), "asOf=2026-04", "text/csv");
    expect(failed.status).toBe(422);
    const [failedRow] = await db.select().from(t.ownershipUploads).where(eq(t.ownershipUploads.status, "FAILED"));
    expect(failedRow).toMatchObject({ asOfMonth: "2026-04", error: expect.stringContaining("No header row") });
    const [failedDoc] = await db.select().from(t.rawDocuments).where(eq(t.rawDocuments.id, failedRow.rawRef));
    expect(failedDoc.parseStatus).toBe("FAILED");

    expect((await upload(new Uint8Array(21 * 1024 * 1024), "asOf=2026-04", "application/pdf")).status).toBe(413);
  });
});
