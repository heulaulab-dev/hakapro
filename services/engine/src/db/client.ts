import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "../../db/schema";

export type EngineDb = ReturnType<typeof createDb>["db"];

export function createDb(url: string, options: { max?: number } = {}) {
  const client = postgres(url, { max: options.max ?? 5, prepare: false, onnotice: () => {} });
  // Separate one-connection pool so a readiness probe never waits behind ingest queries.
  const pingClient = postgres(url, { max: 1, connect_timeout: 4, connection: { statement_timeout: 4000 }, onnotice: () => {} });
  const db = drizzle(client, { schema });
  let pending: Promise<boolean> | undefined;

  /** Bounded DB reachability check; never surfaces connection errors or credentials. */
  async function ping(timeoutMs = 4000): Promise<boolean> {
    pending ??= pingClient`select 1`.then(() => true, () => false).finally(() => { pending = undefined; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([pending, new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); })]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function close(): Promise<void> {
    await Promise.allSettled([client.end({ timeout: 5 }), pingClient.end({ timeout: 5 })]);
  }

  return { db, ping, close };
}

/** Waits for PostgreSQL at startup (it may boot after the engine); throws after `timeoutMs`. */
export async function waitForDatabase(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (let delay = 1000; ; delay = Math.min(delay * 2, 8000)) {
    const probe = postgres(url, { max: 1, connect_timeout: 4, onnotice: () => {} });
    const ok = await probe`select 1`.then(() => true, () => false);
    await probe.end({ timeout: 1 });
    if (ok) return;
    if (Date.now() + delay > deadline) throw new Error("Engine database is not reachable");
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/** services/engine/db/migrations from source; the bundled image sets ENGINE_MIGRATIONS_DIR. */
export function migrationsDir(): string {
  return process.env.ENGINE_MIGRATIONS_DIR ?? fileURLToPath(new URL("../../db/migrations", import.meta.url));
}

/** Applies the engine migrations. */
export async function runMigrations(url: string, migrationsFolder: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end({ timeout: 5 });
  }
}
