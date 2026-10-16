// `bun run engine:db:migrate` (repo root) or `bun migrate.js` in the image. Reads ENGINE_DATABASE_URL only.
import { migrationsDir, runMigrations } from "./client";

const url = process.env.ENGINE_DATABASE_URL;
if (!url) {
  console.error("ENGINE_DATABASE_URL is required");
  process.exit(1);
}
await runMigrations(url, migrationsDir());
console.log(JSON.stringify({ level: "info", event: "engine_migrations_applied" }));
