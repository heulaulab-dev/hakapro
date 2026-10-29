import { createHash } from "node:crypto";
import type { OwnershipService } from "../ownership/service";
import { OWNERSHIP_PARSER_VERSION } from "../ownership/parse";
import type { JobContext, JobDefinition } from "../schedule/scheduler";

export const KSEI_OWNERSHIP_JOB_ID = "ksei-ownership-sync";
const MAX_BYTES = 20 * 1024 * 1024;
const SOURCE_PAGE = "https://www.idx.co.id/id/perusahaan-tercatat/data-kepemilikan-saham/";

type Release = { as_of: string; format: string; file: string; source_url: string; sha256: string; bytes: number };

const digest = async (bytes: Uint8Array) => {
  const hash = createHash("sha256");
  hash.update(bytes);
  return hash.digest("hex");
};

export function kseiOwnershipJob(ownership: OwnershipService, indexUrl: string, now: () => Date): JobDefinition {
  const index = new URL(indexUrl);
  const assetBase = `${index.origin}${index.pathname.slice(0, index.pathname.lastIndexOf("/") + 1)}`;
  return {
    id: KSEI_OWNERSHIP_JOB_ID,
    trigger: { kind: "cron", spec: "30 20 * * *" },
    async run(ctx: JobContext) {
      const indexResponse = await fetch(index, { headers: { accept: "application/json", "user-agent": "hakapro-ksei-import/1" }, signal: AbortSignal.timeout(15_000) });
      if (!indexResponse.ok) throw new Error(`KSEI mirror index HTTP ${indexResponse.status}`);
      const body = await indexResponse.json() as { schema?: string; source_page?: string; releases?: Release[] };
      if (body.schema !== "idx.ownership.mirror.v1" || body.source_page !== SOURCE_PAGE || !Array.isArray(body.releases)) throw new Error("KSEI mirror index provenance/schema mismatch");
      const releases = body.releases.filter((item) => item.format === "xlsx" && /^\d{4}-\d{2}-\d{2}$/.test(item.as_of) && /^[a-z0-9.-]+\.xlsx$/.test(item.file) && /^https:\/\/www\.idx\.co\.id\/Media\/[A-Za-z0-9]+\/[^/?#]+\.xlsx$/.test(item.source_url)).sort((a, b) => a.as_of.localeCompare(b.as_of));
      if (!releases.length) throw new Error("No valid KSEI XLSX releases");
      // Import missing months chronologically so ownership changes can be derived when a later snapshot exists.
      const uploads = await ownership.store.listUploads(500);
      const existing = new Set(uploads.filter((u) => u.status === "PARSED").map((u) => u.asOfMonth));
      let rows = 0;
      for (const release of releases) {
        const releaseMonth = release.as_of.slice(0, 7);
        if (existing.has(releaseMonth)) {
          // Reprocess an already stored raw workbook after parser/schema improvements.
          const previous = uploads.find((u) => u.asOfMonth === releaseMonth && u.status === "PARSED");
          if (previous && previous.stats?.parserVersion !== OWNERSHIP_PARSER_VERSION) {
            const reparsed = await ownership.reparse(previous.id);
            if (!reparsed || reparsed.status !== "PARSED") throw new Error(`KSEI reparse failed for ${releaseMonth}: ${reparsed?.error ?? "upload not found"}`);
            rows += reparsed.stats?.rowsAccepted ?? 0;
          }
          continue;
        }
        const fileResponse = await fetch(`${assetBase}${release.file}`, { headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "user-agent": "hakapro-ksei-import/1" }, signal: AbortSignal.timeout(30_000) });
        if (!fileResponse.ok) throw new Error(`KSEI release HTTP ${fileResponse.status}`);
        const bytes = new Uint8Array(await fileResponse.arrayBuffer());
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES || bytes.byteLength !== release.bytes || await digest(bytes) !== release.sha256) throw new Error(`KSEI release size/hash validation failed for ${release.as_of}`);
        const outcome = await ownership.upload({ bytes, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", fileName: release.file, asOfMonth: releaseMonth, snapshotDate: release.as_of, sourceLabel: `KSEI via IDX; ${release.source_url}; mirror SHA-256 ${release.sha256}` });
        if (outcome.kind === "unsupported" || outcome.kind === "conflict") throw new Error(`KSEI upload ${outcome.kind}: ${outcome.message}`);
        if (outcome.kind === "created" && outcome.upload.status !== "PARSED") throw new Error(outcome.upload.error ?? "KSEI upload parse failed");
        rows += outcome.upload.stats?.rowsAccepted ?? 0;
        existing.add(releaseMonth);
      }
      ctx.report.rows(rows);
      void now;
      return { status: "SUCCEEDED", message: `Imported missing KSEI monthly snapshots; ${rows} rows accepted` };
    },
  };
}
