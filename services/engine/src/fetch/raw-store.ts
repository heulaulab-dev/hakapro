import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

/** Raw document store: R2/S3 in deployment, a local directory as the fallback (§3). */
export interface RawStore {
  readonly kind: "s3" | "local";
  put(key: string, body: Uint8Array, contentType?: string | null): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  exists(key: string): Promise<boolean>;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function assertKey(key: string): void {
  if (!KEY.test(key) || key.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("Invalid raw store key");
  }
}

const EXTENSIONS: Array<[string, string]> = [
  ["json", ".json"], ["csv", ".csv"], ["html", ".html"], ["xml", ".xml"], ["pdf", ".pdf"], ["zip", ".zip"], ["text/plain", ".txt"],
];

/** `<source>/<YYYY-MM-DD>/<sha256><ext>`: content-addressed, so re-storing the same bytes is idempotent. */
export function rawKey(source: string, fetchedAt: Date, sha256: string, contentType?: string | null): string {
  const type = contentType?.toLowerCase() ?? "";
  const ext = EXTENSIONS.find(([needle]) => type.includes(needle))?.[1] ?? ".bin";
  const key = `${source}/${fetchedAt.toISOString().slice(0, 10)}/${sha256}${ext}`;
  assertKey(key);
  return key;
}

export class LocalRawStore implements RawStore {
  readonly kind = "local";
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    assertKey(key);
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error("Invalid raw store key");
    return full;
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    // Write-then-rename so a crash never leaves a truncated document under the final key.
    const temp = `${target}.tmp-${randomUUID()}`;
    await writeFile(temp, body);
    await rename(temp, target);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      return (await stat(this.path(key))).isFile();
    } catch {
      return false;
    }
  }
}

/** The subset of Bun's S3Client this store uses (kept structural so tests can fake it). */
export type S3Like = {
  write(key: string, data: Uint8Array, options?: { type?: string }): Promise<number>;
  exists(key: string): Promise<boolean>;
  file(key: string): { arrayBuffer(): Promise<ArrayBuffer> };
};

export class S3RawStore implements RawStore {
  readonly kind = "s3";

  constructor(private readonly client: S3Like) {}

  async put(key: string, body: Uint8Array, contentType?: string | null): Promise<void> {
    assertKey(key);
    await this.client.write(key, body, contentType ? { type: contentType } : undefined);
  }

  async get(key: string): Promise<Uint8Array | null> {
    assertKey(key);
    if (!(await this.client.exists(key))) return null;
    return new Uint8Array(await this.client.file(key).arrayBuffer());
  }

  exists(key: string): Promise<boolean> {
    assertKey(key);
    return this.client.exists(key);
  }
}

export type RawS3Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string };

/** R2/S3 via Bun's built-in S3 client when configured; otherwise `${dataDir}/raw`. */
export function createRawStore(s3: RawS3Config | null, dataDir: string): RawStore {
  if (!s3) return new LocalRawStore(join(dataDir, "raw"));
  const bun = (globalThis as { Bun?: { S3Client: new (options: Record<string, string>) => S3Like } }).Bun;
  if (!bun) throw new Error("The S3 raw store requires the Bun runtime");
  return new S3RawStore(new bun.S3Client({
    endpoint: s3.endpoint, bucket: s3.bucket, accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey, region: s3.region,
  }));
}
