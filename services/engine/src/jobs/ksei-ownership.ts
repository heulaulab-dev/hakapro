import { createHash } from "node:crypto";
import type { OwnershipService } from "../ownership/service";
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
      const release = body.releases.filter((item) => item.format === "xlsx" && /^\d{4}-\d{2}-\d{2}$/.test(item.as_of) && /^[a-z0-9.-]+\.xlsx$/.test(item.file)).sort((a, b) => a.as_of.localeCompare(b.as_of)).at(-1);
      if (!release || !/^https:\/\/www\.idx\.co\.id\/Media\/[A-Za-z0-9]+\/[^/?#]+\.xlsx$/.test(release.source_url)) throw new Error("No valid KSEI XLSX release");
      const fileResponse = await fetch(`${assetBase}${release.file}`, { headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "user-agent": "hakapro-ksei-import/1" }, signal: AbortSignal.timeout(30_000) });
      if (!fileResponse.ok) throw new Error(`KSEI release HTTP ${fileResponse.status}`);
      const bytes = new Uint8Array(await fileResponse.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES || bytes.byteLength !== release.bytes || await digest(bytes) !== release.sha256) throw new Error("KSEI release size/hash validation failed");
      const outcome = await ownership.upload({
        bytes,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileName: release.file,
        asOfMonth: release.as_of.slice(0, 7),
        snapshotDate: release.as_of,
        sourceLabel: `KSEI via IDX; ${release.source_url}; mirror SHA-256 ${release.sha256}`,
      });
      if (outcome.kind === "unsupported" || outcome.kind === "conflict") throw new Error(`KSEI upload ${outcome.kind}: ${outcome.message}`);
      const upload = outcome.upload;
      ctx.report.rows(upload.stats?.rowsAccepted ?? 0);
      if (outcome.kind === "created" && upload.status !== "PARSED") throw new Error(upload.error ?? "KSEI upload parse failed");
      void now;
      return { status: "SUCCEEDED" };
    },
  };
}
