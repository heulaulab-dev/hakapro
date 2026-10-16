import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { tempDir } from "../../test/support";
import { LocalRawStore, S3RawStore, assertKey, createRawStore, rawKey, type S3Like } from "./raw-store";

describe("rawKey", () => {
  it("is content-addressed per source and day, with an extension from the content type", () => {
    const sha = "a".repeat(64);
    expect(rawKey("idx-eod", new Date("2026-10-14T09:30:00Z"), sha, "application/json; charset=utf-8")).toBe(`idx-eod/2026-10-14/${sha}.json`);
    expect(rawKey("idx-eod", new Date("2026-10-14T09:30:00Z"), sha, null)).toBe(`idx-eod/2026-10-14/${sha}.bin`);
  });

  it("rejects traversal and odd keys", () => {
    for (const key of ["../etc/passwd", "a/../../b", "/abs", "a//b", "a/./b", "a b"]) expect(() => assertKey(key)).toThrow();
  });
});

describe("LocalRawStore", () => {
  let dir: Awaited<ReturnType<typeof tempDir>>;
  beforeEach(async () => { dir = await tempDir(); });
  afterEach(async () => { await dir.cleanup(); });

  it("round-trips bytes and reports existence", async () => {
    const store = new LocalRawStore(dir.path);
    const key = "src/2026-10-14/abc.csv";
    expect(await store.exists(key)).toBe(false);
    expect(await store.get(key)).toBeNull();
    await store.put(key, new TextEncoder().encode("1,2,3"));
    expect(await store.exists(key)).toBe(true);
    expect(new TextDecoder().decode((await store.get(key))!)).toBe("1,2,3");
    // No temp files left behind.
    expect(await readdir(join(dir.path, "src/2026-10-14"))).toEqual(["abc.csv"]);
  });

  it("is the fallback when no S3 config is given", () => {
    expect(createRawStore(null, dir.path).kind).toBe("local");
  });
});

describe("S3RawStore", () => {
  it("writes with the content type and reads back through the client", async () => {
    const objects = new Map<string, { data: Uint8Array; type?: string }>();
    const client: S3Like = {
      write: async (key, data, options) => { objects.set(key, { data, type: options?.type }); return data.byteLength; },
      exists: async (key) => objects.has(key),
      file: (key) => ({ arrayBuffer: async () => objects.get(key)!.data.slice().buffer }),
    };
    const store = new S3RawStore(client);
    await store.put("s/2026-10-14/x.json", new TextEncoder().encode("{}"), "application/json");
    expect(objects.get("s/2026-10-14/x.json")?.type).toBe("application/json");
    expect(new TextDecoder().decode((await store.get("s/2026-10-14/x.json"))!)).toBe("{}");
    expect(await store.get("s/2026-10-14/missing.json")).toBeNull();
  });
});
