/**
 * Import the newest KSEI >=1% register published by IDX into the Engine.
 *
 * This is deliberately a fixed-source task: it only reads the CI-maintained
 * byte-identical mirror of IDX/KSEI files, verifies the release metadata, and
 * posts the file to the Engine's existing authenticated ownership-upload route.
 * It never accepts a user-supplied URL or forwards arbitrary requests.
 */
import { createHash } from "node:crypto";

const INDEX_URL = "https://github.com/fzn0x/idx/releases/download/ownership-data/index.json";
const ASSET_BASE = "https://github.com/fzn0x/idx/releases/download/ownership-data/";
const SOURCE_PAGE = "https://www.idx.co.id/id/perusahaan-tercatat/data-kepemilikan-saham/";
const MAX_BYTES = 20 * 1024 * 1024;

type Release = {
  as_of: string;
  format: string;
  file: string;
  source_url: string;
  sha256: string;
  bytes: number;
};

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const fixedUrl = (value: string, expectedOrigin: string, expectedPath?: string) => {
  const url = new URL(value);
  if (url.origin !== expectedOrigin || url.username || url.password || url.search || url.hash || (expectedPath && url.pathname !== expectedPath)) {
    throw new Error("unexpected fixed-source URL");
  }
  return url;
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function main() {
  const engineUrl = new URL(process.env.KSEI_ENGINE_URL ?? "http://127.0.0.1:8080");
  if (!["http:", "https:"].includes(engineUrl.protocol) || engineUrl.username || engineUrl.password || engineUrl.search || engineUrl.hash) {
    throw new Error("KSEI_ENGINE_URL must be an http(s) origin without credentials or query parameters");
  }
  const token = required("ENGINE_ADMIN_TOKEN");

  const indexResponse = await fetch(INDEX_URL, { headers: { accept: "application/json", "user-agent": "hakapro-ksei-import/1" } });
  if (!indexResponse.ok) throw new Error(`ownership mirror index failed: HTTP ${indexResponse.status}`);
  const index = await indexResponse.json() as { schema?: string; source_page?: string; releases?: Release[] };
  if (index.schema !== "idx.ownership.mirror.v1" || index.source_page !== SOURCE_PAGE || !Array.isArray(index.releases)) {
    throw new Error("ownership mirror index failed schema/provenance validation");
  }
  const releases = index.releases
    .filter((release) => release.format === "xlsx" && /^\d{4}-\d{2}-\d{2}$/.test(release.as_of) && /^[a-z0-9.-]+\.xlsx$/.test(release.file))
    .sort((a, b) => a.as_of.localeCompare(b.as_of));
  const release = releases.at(-1);
  if (!release || !/^https:\/\/www\.idx\.co\.id\/Media\/[A-Za-z0-9]+\/[^/?#]+\.xlsx$/.test(release.source_url)) {
    throw new Error("no valid KSEI XLSX release found");
  }
  fixedUrl(`${ASSET_BASE}${release.file}`, "https://github.com");

  const fileResponse = await fetch(`${ASSET_BASE}${release.file}`, { headers: { accept: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "user-agent": "hakapro-ksei-import/1" } });
  if (!fileResponse.ok) throw new Error(`ownership release download failed: HTTP ${fileResponse.status}`);
  const bytes = new Uint8Array(await fileResponse.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES || bytes.byteLength !== release.bytes || sha256(bytes) !== release.sha256) {
    throw new Error("ownership release failed size/hash validation");
  }

  const form = new FormData();
  form.set("file", new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), release.file);
  form.set("asOf", release.as_of.slice(0, 7));
  form.set("snapshotDate", release.as_of);
  form.set("source", `KSEI via IDX; ${release.source_url}; mirror SHA-256 ${release.sha256}`);
  const upload = await fetch(new URL("/v1/admin/ownership/upload", engineUrl), {
    method: "POST", headers: { authorization: `Bearer ${token}` }, body: form,
  });
  const body = await upload.text();
  if (!upload.ok && upload.status !== 409) throw new Error(`Engine ownership import failed: HTTP ${upload.status} ${body.slice(0, 500)}`);
  console.log(JSON.stringify({ status: upload.status, snapshotDate: release.as_of, file: release.file, bytes: bytes.byteLength, sha256: release.sha256, response: body.slice(0, 500) }));
}

await main();
