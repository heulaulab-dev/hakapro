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
