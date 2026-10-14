/** Transfer a small private snapshot as a temporary Coolify secret, never as image content. */
import { gzipSync, gunzipSync } from "node:zlib";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadSnapshot, reportFailure, runMigration } from "./supabase-import";

async function main() {
  process.umask(0o077);
  const mode = process.argv[2];
  if (mode === "pack") {
    const directory = resolve(process.env.MIGRATION_SNAPSHOT_DIR ?? "");
    await loadSnapshot(directory);
    const destination = process.env.SNAPSHOT_TRANSFER_FILE;
    if (!destination) throw new Error("Transfer output path required");
    const envelope = { dataSQL: await readFile(join(directory, "data.sql"), "utf8"), manifest: JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) };
    const packed = gzipSync(Buffer.from(JSON.stringify(envelope)), { level: 9 }).toString("base64");
    // Linux limits each environment string. Larger snapshots require secure file transfer.
    if (packed.length > 100_000) throw new Error("Snapshot exceeds secret transfer size");
    await writeFile(resolve(destination), packed, { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({ mode: "pack", packedBytes: packed.length }));
    return;
  }
  if (!["inventory", "import", "reconcile"].includes(mode)) throw new Error("Unsupported runner mode");
  const secret = process.env.MIGRATION_SNAPSHOT_GZIP_BASE64;
  // Do not forward the transfer secret to pg_dump or any child process.
  delete process.env.MIGRATION_SNAPSHOT_GZIP_BASE64;
  if (!secret || secret.length > 100_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(secret)) throw new Error("Invalid transfer secret");
  const bytes = gunzipSync(Buffer.from(secret, "base64"), { maxOutputLength: 16 * 1024 * 1024 });
  const envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!envelope || typeof envelope.dataSQL !== "string" || !envelope.manifest || typeof envelope.manifest !== "object") throw new Error("Invalid snapshot envelope");
  const directory = await mkdtemp(join(tmpdir(), "hakapro-private-import-"));
  try {
    await writeFile(join(directory, "data.sql"), envelope.dataSQL, { mode: 0o600, flag: "wx" });
    await writeFile(join(directory, "manifest.json"), JSON.stringify(envelope.manifest), { mode: 0o600, flag: "wx" });
    process.env.MIGRATION_SNAPSHOT_DIR = directory;
    await runMigration();
  } finally {
    delete process.env.MIGRATION_SNAPSHOT_DIR;
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(reportFailure);
