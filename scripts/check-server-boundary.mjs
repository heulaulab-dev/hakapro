#!/usr/bin/env node
// Proves the server-only boundary holds in the real Next build:
//  1. The Vitest stub for `server-only` is not referenced by any Next/TS config, and the
//     installed package still throws outside the react-server condition.
//  2. A client component importing a module from src/server/** fails `next build`.
// The probe route is created temporarily and always removed. It must not start with "_":
// App Router treats underscore folders as private and would never compile the probe.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const fail = (message) => { console.error(`✗ ${message}`); process.exit(1); };

// 1. Stub isolation.
for (const file of ["next.config.ts", "tsconfig.json", "package.json"]) {
  if (readFileSync(join(root, file), "utf8").includes("tests/support/server-only")) fail(`${file} references the Vitest server-only stub`);
}
if (!readFileSync(join(root, "vitest.config.mts"), "utf8").includes("tests/support/server-only")) fail("vitest.config.mts no longer aliases server-only (unit tests would import the real guard)");
const require = createRequire(join(root, "package.json"));
const resolved = require.resolve("server-only");
if (!resolved.includes(join("node_modules", "server-only"))) fail(`server-only resolves to ${resolved}, not the real package`);
let threw = false;
try { require("server-only"); } catch { threw = true; }
if (!threw) fail("the installed server-only package did not throw outside react-server");
console.log(`✓ server-only resolves to the real package (${resolved.replace(root + "/", "")}) and the Vitest stub is test-only`);

// 2. Client import must break the build.
const probeDir = join(root, "src/app/server-boundary-probe");
if (existsSync(probeDir)) fail(`${probeDir} already exists; remove it first`);
mkdirSync(probeDir, { recursive: true });
writeFileSync(join(probeDir, "page.tsx"), `"use client";
import { logWarn } from "@/server/log";

export default function Probe() {
  logWarn("probe");
  return null;
}
`);
let result;
try {
  result = spawnSync("bun", ["run", "build"], {
    cwd: root,
    encoding: "utf8",
    // The production guards need a non-fixture source and Better Auth/PG config. These placeholders are
    // compile-only: this probe build is expected to fail and its output is never served.
    env: { ...process.env, MARKET_DATA_SOURCE: "arjum", HEULATRADE_MARKET_API_BASE_URL: "https://build-check.invalid", HEULATRADE_MARKET_API_KEY: "build-check", DEV_AUTH_BYPASS: "", DATABASE_URL: "postgresql://build-check:build-check@127.0.0.1:5432/build_check", BETTER_AUTH_URL: "https://hakapro.id", BETTER_AUTH_SECRET: "compile-only-placeholder-at-least-32-characters", GOOGLE_CLIENT_ID: "compile-only", GOOGLE_CLIENT_SECRET: "compile-only", BETTER_AUTH_ENVIRONMENT: "production", BETTER_AUTH_REHEARSAL_URL: "", SMTP_HOST: "", SMTP_PORT: "", SMTP_USER: "", SMTP_PASSWORD: "", SMTP_FROM: "", SMTP_SECURE: "" },
  });
} finally {
  rmSync(probeDir, { recursive: true, force: true });
}
const output = `${result.stdout}\n${result.stderr}`;
if (result.status === 0) fail("next build succeeded even though a client component imports src/server/log.ts");
if (!/server-only|Server Component|react-server/i.test(output)) {
  console.error(output.slice(-3000));
  fail("next build failed, but not with a server-only boundary error");
}
console.log("✓ next build fails when a client component imports src/server/** (server-only boundary enforced)");
