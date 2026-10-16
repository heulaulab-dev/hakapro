// Upload flow and the HAKA-33/34 derivations on two SYNTHETIC months (fake tickers and holders only).
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAR_2026, syntheticOwnershipCsv } from "../../test/ownership-fixtures";
import { tempDir } from "../../test/support";
import { LocalRawStore } from "../fetch/raw-store";
import { MemoryRawDocumentIndex } from "../fetch/stores";
import { OwnershipService, type UploadInput } from "./service";
import { MemoryOwnershipStore } from "./store";

const committed = (name: string) => new Uint8Array(readFileSync(new URL(`../../test/fixtures/ownership/${name}`, import.meta.url)));
const FEB_PDF = () => committed("synthetic-1pct-2026-02.pdf");
const MAR_PDF = () => committed("synthetic-1pct-2026-03.pdf");
const input = (bytes: Uint8Array, asOfMonth: string, extra: Partial<UploadInput> = {}): UploadInput =>
  ({ bytes, contentType: "application/pdf", fileName: `synthetic-${asOfMonth}.pdf`, asOfMonth, sourceLabel: null, snapshotDate: null, ...extra });

describe("OwnershipService", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  let store: MemoryOwnershipStore;
  let documents: MemoryRawDocumentIndex;
  let rawStore: LocalRawStore;
  let service: OwnershipService;
  const parseStatus: Array<[string, string]> = [];

  beforeEach(async () => {
    dir = await tempDir("ownership-");
    store = new MemoryOwnershipStore();
    documents = new MemoryRawDocumentIndex();
    rawStore = new LocalRawStore(dir.path);
    parseStatus.length = 0;
    service = new OwnershipService({
      store, rawStore, documents, now: () => new Date("2026-10-16T08:00:00Z"),
      setParseStatus: async (id, status) => { parseStatus.push([id, status]); },
    });
  });
  afterEach(async () => { await dir.cleanup(); });

  const created = async (bytes: Uint8Array, month: string, extra: Partial<UploadInput> = {}) => {
    const outcome = await service.upload(input(bytes, month, extra));
    if (outcome.kind !== "created") throw new Error(`expected created, got ${outcome.kind}`);
    return outcome.upload;
  };

  it("stores the raw copy, parses, and records the upload", async () => {
    const upload = await created(FEB_PDF(), "2026-02", { sourceLabel: "SYNTHETIC announcement 001" });
    expect(upload).toMatchObject({ status: "PARSED", asOfMonth: "2026-02", snapshotDate: "2026-02-27", format: "pdf", error: null, issues: [] });
    expect(upload.stats).toMatchObject({ parserVersion: "ksei-1pct-layout@0.1", rowsAccepted: 9, issuers: 3, setsReplaced: 0, changes: 0 });
    const [doc] = documents.docs;
    expect(doc).toMatchObject({ source: "ownership-upload", url: `upload://ownership/${upload.sha256}`, contentType: "application/pdf", httpStatus: 200 });
    expect(doc.r2Key).toBe(`ownership-upload/2026-10-16/${upload.sha256}.pdf`);
    expect(Buffer.from((await rawStore.get(doc.r2Key))!).equals(Buffer.from(FEB_PDF()))).toBe(true);
    expect(parseStatus).toEqual([[doc.id, "PARSED"]]);
    expect(store.rowsIngested).toBe(9);

    const set = (await store.getSet("TEST1", "2026-02"))!;
    expect(set).toMatchObject({
      uploadId: upload.id, snapshotDate: "2026-02-27", issuerName: "PT CONTOH DUMMY TBK", dataset: "ksei-1pct-manual-upload",
      thresholdPercent: "1.000000", issuedShares: null, sourceReference: "SYNTHETIC announcement 001", rowCount: 5,
      comparison: { status: "NO_PREVIOUS", fromMonth: null, toDate: "2026-02-27" },
    });
    expect(set.rows[0]).toEqual({
      lineNo: 1, holderKey: "org:CONTOH INDUK FIKTIF", holderName: "PT CONTOH INDUK FIKTIF", holderKind: "organisation",
      shares: "600000000", percent: "60.000000", investorType: "CP", localForeign: "L", sourceReference: `upload:${upload.id}#p1.l4`,
    });
  });

  it("computes per-holder changes between two adjacent synthetic months", async () => {
    await created(FEB_PDF(), "2026-02");
    const march = await created(MAR_PDF(), "2026-03");
    expect(march.issues.filter((issue) => issue.severity === "error")).toHaveLength(2); // the malformed line, not fatal
    expect(march.stats).toMatchObject({ rowsAccepted: 10, rowsRejected: 1, changes: 9 });

    const changes = await store.changes("2026-03");
    const by = (symbol: string, name: string) => changes.find((change) => change.symbol === symbol && change.holderName === name)!;
    expect(by("TEST1", "PT CONTOH INDUK FIKTIF")).toMatchObject({
      kind: "INCREASE", sharesBefore: "600000000", sharesAfter: "610000000", shareDelta: "10000000",
      percentBefore: "60.000000", percentAfter: "61.000000", ppDelta: "1.000000", flags: [], fromDate: "2026-02-27", toDate: "2026-03-31",
      derivation: "haka33-compare@1",
    });
    expect(by("TEST1", "ANDI CONTOH")).toMatchObject({ kind: "NEW", sharesBefore: null, sharesAfter: "11000000", flags: ["PRIOR_HOLDING_UNKNOWN"], fromReferences: [] });
    expect(by("TEST1", "REKSA DANA CONTOH SAHAM")).toMatchObject({ kind: "BELOW_THRESHOLD", sharesAfter: null, toReferences: [] });
    expect(by("TEST1", "BUDI CONTOH")).toMatchObject({ kind: "UNCHANGED", shareDelta: "0" });
    expect(by("TEST1", "DUMMY CUSTODIAN BANK SINGAPORE BRANCH S/A CONTOH CLIENT ACCOUNT")).toMatchObject({ kind: "UNCHANGED", holderKind: "custodian_nominee" });
    expect(by("TEST2", "PT FIKTIF HOLDCO")).toMatchObject({ kind: "DECREASE", shareDelta: "-10000000", ppDelta: "-1.000000" });
    expect(by("TEST2", "SITI CONTOH")).toMatchObject({ kind: "UNCHANGED", flags: ["DUPLICATE_ROWS_COLLAPSED"] });
    expect(by("TEST2", "SITI CONTOH").toReferences).toEqual([`upload:${march.id}#p2.l1`, `upload:${march.id}#p2.l2`]);
    expect(changes.some((change) => change.kind === "EXIT")).toBe(false);

    const test1 = (await store.getSet("TEST1", "2026-03"))!;
    expect(test1.comparison).toMatchObject({ status: "COMPARED", fromMonth: "2026-02", fromDate: "2026-02-27", counts: { NEW: 1, INCREASE: 1, UNCHANGED: 3, BELOW_THRESHOLD: 1, DECREASE: 0, EXIT: 0, AMBIGUOUS: 0 } });
    expect((await store.getSet("TEST4", "2026-03"))!.comparison).toMatchObject({ status: "NO_PREVIOUS" });
    // TEST3 is only in February: nothing is claimed about it for March.
    expect(changes.some((change) => change.symbol === "TEST3")).toBe(false);
  });

  it("stores the HAKA-34 estimate as a draft, never official", async () => {
    await created(MAR_PDF(), "2026-03");
    const freeFloat = (await store.getSet("TEST1", "2026-03"))!.freeFloat!;
    expect(freeFloat).toMatchObject({
      methodologyStatus: "draft", figureType: "ESTIMATE", isOfficial: false, methodology: { version: "0.1-draft", status: "DRAFT_AWAITING_OWNER_APPROVAL" },
      asOf: "2026-03-31", estimate: { headline: "26.400000", low: "26.400000", high: "35.900000" },
      totals: { strategic: "64.100000", unknown: "9.500000", portfolio: "0.000000" },
    });
    const rules = Object.fromEntries((freeFloat.holders as Array<{ holderName: string; rule: string }>).map((holder) => [holder.holderName, holder.rule]));
    expect(rules).toMatchObject({ "PT CONTOH INDUK FIKTIF": "AT_OR_ABOVE_5_PERCENT", "NEGARA REPUBLIK INDONESIA": "GOVERNMENT", "BUDI CONTOH": "DEFAULT_UNKNOWN" });
    expect(rules["DUMMY CUSTODIAN BANK SINGAPORE BRANCH S/A CONTOH CLIENT ACCOUNT"]).toBe("NOMINEE_ACCOUNT");
    const pension = (await store.getSet("TEST2", "2026-03"))!.freeFloat!.holders as Array<{ holderName: string; rule: string }>;
    expect(pension.find((holder) => holder.holderName === "DANA PENSIUN CONTOH")?.rule).toBe("FUND_INVESTOR_TYPE");
  });

  it("re-derives the later month when an earlier one arrives afterwards", async () => {
    await created(MAR_PDF(), "2026-03");
    expect((await store.getSet("TEST1", "2026-03"))!.comparison).toMatchObject({ status: "NO_PREVIOUS" });
    await created(FEB_PDF(), "2026-02");
    expect((await store.getSet("TEST1", "2026-03"))!.comparison).toMatchObject({ status: "COMPARED", fromMonth: "2026-02" });
    expect(await store.changes("2026-03")).toHaveLength(9);
  });

  it("does not compare months that aren't adjacent", async () => {
    await created(FEB_PDF(), "2026-02");
    const april = new TextEncoder().encode(syntheticOwnershipCsv({ ...MAR_2026, date: "30-Apr-2026" }));
    const upload = await created(april, "2026-04", { contentType: "text/csv", fileName: "april.csv" });
    expect(upload.format).toBe("csv");
    expect((await store.getSet("TEST1", "2026-04"))!.comparison).toMatchObject({ status: "NOT_ADJACENT", fromMonth: "2026-02", detail: expect.stringContaining("2026-03 is not stored") });
    expect(await store.changes("2026-04")).toEqual([]);
  });

  it("replaces a month's sets on a corrected re-upload and recomputes its changes", async () => {
    await created(FEB_PDF(), "2026-02");
    await created(MAR_PDF(), "2026-03");
    const csv = await created(committed("synthetic-1pct-2026-03.csv"), "2026-03", { contentType: "text/csv", fileName: "march.csv" });
    expect(csv.stats).toMatchObject({ setsReplaced: 3, changes: 9 });
    expect(store.sets.filter((set) => set.month === "2026-03")).toHaveLength(3);
    expect((await store.getSet("TEST1", "2026-03"))!.uploadId).toBe(csv.id);
    const changes = await store.changes("2026-03");
    expect(changes).toHaveLength(9);
    expect(changes.every((change) => change.toReferences.every((ref) => ref.startsWith(`upload:${csv.id}#r`)))).toBe(true);
  });

  it("deduplicates identical bytes and refuses them for another month", async () => {
    const first = await created(FEB_PDF(), "2026-02");
    expect(await service.upload(input(FEB_PDF(), "2026-02"))).toEqual({ kind: "duplicate", upload: first });
    expect(await service.upload(input(FEB_PDF(), "2026-03"))).toMatchObject({ kind: "conflict", message: "This file was already uploaded for 2026-02" });
    expect(documents.docs).toHaveLength(1);
    expect(store.uploads).toHaveLength(1);
  });

  it("marks an unreadable file FAILED with its error, keeps the raw copy and stores no set", async () => {
    const upload = await created(new TextEncoder().encode("no;header;here\n1;2;3\n"), "2026-02", { contentType: "text/csv", fileName: "bad.csv" });
    expect(upload).toMatchObject({ status: "FAILED", error: expect.stringContaining("No header row found") });
    expect(documents.docs).toHaveLength(1);
    expect(parseStatus.at(-1)?.[1]).toBe("FAILED");
    expect(store.sets).toEqual([]);
    expect(await service.upload(input(new Uint8Array([0, 1, 2]), "2026-02", { contentType: "image/png" }))).toMatchObject({ kind: "unsupported" });
  });

  it("re-parses a stored upload from its raw copy", async () => {
    const upload = await created(FEB_PDF(), "2026-02");
    const again = (await service.reparse(upload.id))!;
    expect(again).toMatchObject({ id: upload.id, status: "PARSED", stats: { setsReplaced: 3, rowsAccepted: 9 } });
    expect(store.sets).toHaveLength(3);
    expect(await service.reparse("00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("runs uploads one at a time", async () => {
    const [feb, mar] = await Promise.all([service.upload(input(FEB_PDF(), "2026-02")), service.upload(input(MAR_PDF(), "2026-03"))]);
    expect([feb.kind, mar.kind]).toEqual(["created", "created"]);
    expect((await store.getSet("TEST1", "2026-03"))!.comparison).toMatchObject({ status: "COMPARED" });
  });
});
