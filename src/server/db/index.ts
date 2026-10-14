import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for database access");
}

const globalForDb = globalThis as unknown as { hakaproPg?: ReturnType<typeof postgres> };
const client = globalForDb.hakaproPg ?? postgres(databaseUrl, {
  prepare: false,
  max: process.env.NODE_ENV === "production" ? 10 : 5,
});
if (process.env.NODE_ENV !== "production") globalForDb.hakaproPg = client;

export const db = drizzle(client, { schema, casing: "snake_case" });
export type Db = typeof db;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };

// Separate pool prevents readiness timeouts from occupying product query connections.
const readinessClient = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 4,
  connection: { statement_timeout: 4000 },
  onnotice: () => {},
});
let readinessPing: Promise<boolean> | undefined;

/** Bounded readiness response; never returns database errors or credentials. */
export async function checkDatabaseConnection(): Promise<boolean> {
  // Reuse a pending ping so an unreachable socket cannot accumulate queued checks.
  readinessPing ??= readinessClient`select 1`.then(() => true, () => false).finally(() => { readinessPing = undefined; });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readinessPing,
      new Promise<boolean>((resolve) => { timeout = setTimeout(() => resolve(false), 4000); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
