// Ownership upload flow (DATA-ENGINE.md §8.5d): the owner uploads the monthly ≥1% list; nothing is ever fetched from
// IDX or KSEI. One upload at a time (in-process queue):
//   bytes → format check → sha256 dedupe → raw store + raw_documents → ownership_uploads (RECEIVED)
//         → parse (PDF/CSV/XLSX) → snapshot sets per issuer (replacing that month's set) → HAKA-33 changes against the
//           previous month and the HAKA-34 draft estimate → PARSED (or FAILED with the error and row issues).
import { createHash } from "node:crypto";
import { canonicalPercent } from "@/lib/ownership/decimal";
import { rawKey, type RawStore } from "../fetch/raw-store";
import type { RawDocumentIndex } from "../fetch/stores";
import { nullLogger, type Logger } from "../log";
import { deriveAfterUpload, deriveSet } from "./derive";
import { OWNERSHIP_DATASET, OWNERSHIP_THRESHOLD_PERCENT } from "./normalize";
import { OWNERSHIP_PARSER_VERSION, parseOwnershipFile } from "./parse";
import { CONTENT_TYPES, detectFormat, OwnershipFileError, type ParseIssue } from "./raw-table";
import type { NewSet, OwnershipStore, UploadRecord } from "./store";

/** Source id of manual uploads (a row in `sources`, so raw_documents can reference it and /v1/meta/health lists it). */
export const OWNERSHIP_SOURCE_ID = "ownership-upload";
export const OWNERSHIP_SOURCE_HOST = "admin-upload";
/** Row issues kept per upload; the rest are counted (stats.issuesTruncated). */
export const MAX_STORED_ISSUES = 500;

export type UploadInput = {
  bytes: Uint8Array; contentType: string | null; fileName: string | null;
  asOfMonth: string; sourceLabel: string | null; snapshotDate: string | null;
};

export type UploadOutcome =
  | { kind: "created"; upload: UploadRecord }
  | { kind: "duplicate"; upload: UploadRecord }
  | { kind: "conflict"; upload: UploadRecord; message: string }
  | { kind: "unsupported"; message: string };

export type OwnershipServiceDeps = {
  store: OwnershipStore;
  rawStore: RawStore;
  documents: RawDocumentIndex;
  /** Records PARSED/FAILED on the raw_documents row (optional in tests). */
  setParseStatus?: (id: string, status: "PARSED" | "FAILED", error?: string | null) => Promise<void>;
  now?: () => Date;
  log?: Logger;
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export class OwnershipService {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly now: () => Date;
  private readonly log: Logger;

  constructor(private readonly deps: OwnershipServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? nullLogger;
  }

  get store(): OwnershipStore {
    return this.deps.store;
  }

  /** Runs uploads and re-parses one at a time, so two files for one month never interleave their set replacements. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }

  upload(input: UploadInput): Promise<UploadOutcome> {
    return this.exclusive(async () => {
      const format = detectFormat(input.bytes, input.contentType, input.fileName);
      if (!format) return { kind: "unsupported", message: "Only PDF, XLSX or CSV files are accepted" };
      const sha = sha256(input.bytes);
      const existing = await this.deps.store.findUploadBySha(sha);
      if (existing) {
        if (existing.asOfMonth === input.asOfMonth) return { kind: "duplicate", upload: existing };
        return { kind: "conflict", upload: existing, message: `This file was already uploaded for ${existing.asOfMonth}` };
      }
      await this.deps.store.ensureSource();
      const receivedAt = this.now();
      const contentType = CONTENT_TYPES[format];
      const key = rawKey(OWNERSHIP_SOURCE_ID, receivedAt, sha, contentType);
      await this.deps.rawStore.put(key, input.bytes, contentType);
      const document = await this.deps.documents.insert({
        source: OWNERSHIP_SOURCE_ID, url: `upload://ownership/${sha}`, fetchedAt: receivedAt, httpStatus: 200, sha256: sha, r2Key: key,
        contentType, byteSize: input.bytes.byteLength, etag: null, lastModified: null, fetchRunId: null,
      });
      const upload = await this.deps.store.createUpload({
        receivedAt, asOfMonth: input.asOfMonth, snapshotDateOverride: input.snapshotDate, sourceLabel: input.sourceLabel,
        fileName: input.fileName, format, contentType, byteSize: input.bytes.byteLength, sha256: sha, rawRef: document.id,
      });
      this.log.info("ownership_upload_received", { upload: upload.id, month: upload.asOfMonth, format, bytes: upload.byteSize });
      return { kind: "created", upload: await this.process(upload, input.bytes) };
    });
  }

  /** Parses a stored upload again from its raw copy (after a layout.ts change). Null when the upload is unknown. */
  reparse(id: string): Promise<UploadRecord | null> {
    return this.exclusive(async () => {
      const upload = await this.deps.store.getUpload(id);
      if (!upload) return null;
      const bytes = await this.deps.rawStore.get(rawKey(OWNERSHIP_SOURCE_ID, upload.receivedAt, upload.sha256, upload.contentType));
      if (!bytes) {
        return this.deps.store.updateUpload(id, { status: "FAILED", error: "The raw copy of this upload is missing from the raw store", parsedAt: this.now() });
      }
      return this.process(upload, bytes);
    });
  }

  private async process(upload: UploadRecord, bytes: Uint8Array): Promise<UploadRecord> {
    const { store } = this.deps;
    try {
      const parsed = await parseOwnershipFile(bytes, upload.format, {
        month: upload.asOfMonth, snapshotDate: upload.snapshotDateOverride, retrievedAt: upload.receivedAt.toISOString(),
        referencePrefix: `upload:${upload.id}`,
      });
      const reference = upload.sourceLabel ?? `upload:${upload.id}${upload.fileName ? ` (${upload.fileName})` : ""}`;
      const sets: NewSet[] = parsed.issuers.map((issuer) => ({
        uploadId: upload.id, symbol: issuer.ticker, month: upload.asOfMonth, snapshotDate: parsed.snapshotDate, issuerName: issuer.issuerName,
        dataset: OWNERSHIP_DATASET, thresholdPercent: canonicalPercent(OWNERSHIP_THRESHOLD_PERCENT), issuedShares: issuer.issuedShares,
        sourceReference: reference, retrievedAt: upload.receivedAt, rawRef: upload.rawRef,
        rows: issuer.rows.map((row) => ({
          lineNo: row.lineNo, holderKey: row.holderKey, holderName: row.holderName, holderKind: row.holderKind,
          shares: row.shares, percent: row.percent === null ? null : canonicalPercent(row.percent),
          investorType: row.investorType, localForeign: row.localForeign, sourceReference: row.source.reference,
        })),
      }));
      const symbols = sets.map((set) => set.symbol);
      const removed = await store.removeSetsOfUpload(upload.id, symbols);
      const { replaced } = await store.replaceSets(sets);
      let changes = await deriveAfterUpload(store, symbols, upload.asOfMonth);
      changes += await this.rederiveAfterRemoval(removed);
      await store.recordIngest(parsed.stats.rowsAccepted);
      await this.deps.setParseStatus?.(upload.rawRef, "PARSED");
      const finished = await store.updateUpload(upload.id, {
        status: "PARSED", error: null, snapshotDate: parsed.snapshotDate, parsedAt: this.now(), issues: parsed.issues.slice(0, MAX_STORED_ISSUES),
        stats: {
          parserVersion: OWNERSHIP_PARSER_VERSION, ...parsed.stats, pages: parsed.pages, columns: parsed.columns,
          setsReplaced: replaced, changes, issuesTruncated: parsed.issues.length > MAX_STORED_ISSUES,
        },
      });
      this.log.info("ownership_upload_parsed", { upload: upload.id, month: upload.asOfMonth, issuers: parsed.stats.issuers, rows: parsed.stats.rowsAccepted, rejected: parsed.stats.rowsRejected, changes });
      return finished;
    } catch (error) {
      const known = error instanceof OwnershipFileError;
      const message = known ? error.message : `Internal error while parsing: ${error instanceof Error ? error.message : String(error)}`;
      const issues: ParseIssue[] = known ? error.issues : [];
      if (!known) this.log.error("ownership_upload_error", { upload: upload.id, message });
      else this.log.warn("ownership_upload_failed", { upload: upload.id, message });
      // A failed (re-)parse withdraws whatever this upload stored before, so a FAILED upload never serves data.
      const removed = await store.removeSetsOfUpload(upload.id, []).catch(() => []);
      await this.rederiveAfterRemoval(removed).catch(() => 0);
      await this.deps.setParseStatus?.(upload.rawRef, "FAILED", message.slice(0, 500)).catch(() => undefined);
      return store.updateUpload(upload.id, {
        status: "FAILED", error: message, parsedAt: this.now(), issues: issues.slice(0, MAX_STORED_ISSUES), stats: null,
      });
    }
  }

  /** Sets that followed a removed set compare against something else now. */
  private async rederiveAfterRemoval(removed: Array<{ symbol: string; month: string }>): Promise<number> {
    let changes = 0;
    for (const { symbol, month } of removed) {
      const next = await this.deps.store.nextSet(symbol, month);
      if (next) changes += await deriveSet(this.deps.store, symbol, next.month);
    }
    return changes;
  }
}
