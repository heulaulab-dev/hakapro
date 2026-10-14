/** Run committed Drizzle migrations only against the pinned Hakapro production database. */
import { spawn } from "node:child_process";

class MigrationGuardError extends Error {}
function requireCondition(value: unknown, code: string): asserts value {
  if (!value) throw new MigrationGuardError(code);
}

async function main() {
  requireCondition(process.env.PRODUCTION_SCHEMA_MIGRATION_ENABLED === "yes", "PRODUCTION_SCHEMA_MIGRATION_NOT_ENABLED");
  requireCondition(process.env.PRODUCTION_WRITES_PAUSED === "yes", "PRODUCTION_WRITE_FREEZE_REQUIRED");
  const databaseUrl = process.env.PRODUCTION_DATABASE_URL;
  requireCondition(databaseUrl, "MISSING_PRODUCTION_DATABASE_URL");

  let target: URL;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new MigrationGuardError("INVALID_PRODUCTION_DATABASE_URL");
  }
  requireCondition(
    ["postgres:", "postgresql:"].includes(target.protocol)
      && target.hostname === "luspjrb3ibvzma6yc1ilicum"
      && target.pathname === "/hakapro",
    "PRODUCTION_TARGET_REQUIRED",
  );

  const childEnvironment: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: databaseUrl };
  delete childEnvironment.MIGRATION_SNAPSHOT_GZIP_BASE64;
  const child = spawn("bun", ["run", "db:migrate"], {
    env: childEnvironment,
    stdio: "ignore",
  });
  await new Promise<void>((resolve, reject) => {
    child.once("error", () => reject(new MigrationGuardError("DRIZZLE_MIGRATION_LAUNCH_FAILED")));
    child.once("exit", (code) => code === 0 ? resolve() : reject(new MigrationGuardError("DRIZZLE_MIGRATION_FAILED")));
  });
  console.log(JSON.stringify({ mode: "production-schema-migrate", target: "hakapro-production", succeeded: true }));
}

main().catch((error: unknown) => {
  console.error(error instanceof MigrationGuardError ? error.message : "PRODUCTION_SCHEMA_MIGRATION_FAILED");
  process.exitCode = 1;
});
