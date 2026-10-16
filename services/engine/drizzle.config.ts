import { defineConfig } from "drizzle-kit";

// Run from the repo root: `bun run engine:db:generate`. Only drizzle-kit migrate/studio need ENGINE_DATABASE_URL.
export default defineConfig({
  dialect: "postgresql",
  schema: "./services/engine/db/schema.ts",
  out: "./services/engine/db/migrations",
  migrations: { prefix: "timestamp" },
  ...(process.env.ENGINE_DATABASE_URL ? { dbCredentials: { url: process.env.ENGINE_DATABASE_URL } } : {}),
  strict: true,
});
