#!/usr/bin/env node
// Proves production refuses to build with unsafe configuration. Each case must fail at config load.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const valid = {
  MARKET_DATA_SOURCE: "arjum",
  HEULATRADE_MARKET_API_BASE_URL: "https://build-check.invalid",
  HEULATRADE_MARKET_API_KEY: "build-check",
  DATABASE_URL: "postgresql://build-check:build-check@127.0.0.1:5432/build_check",
  BETTER_AUTH_URL: "https://hakapro.id",
  BETTER_AUTH_SECRET: "compile-only-placeholder-at-least-32-characters",
  GOOGLE_CLIENT_ID: "compile-only",
  GOOGLE_CLIENT_SECRET: "compile-only",
  BETTER_AUTH_ENVIRONMENT: "production",
  BETTER_AUTH_REHEARSAL_URL: "",
  SMTP_HOST: "",
  SMTP_PORT: "",
  SMTP_USER: "",
  SMTP_PASSWORD: "",
  SMTP_FROM: "",
  SMTP_SECURE: "",
  DEV_AUTH_BYPASS: "",
};
const cases = [
  ["fixture data", { MARKET_DATA_SOURCE: "fixture" }, "MarketSourceConfigError"],
  ["missing data source", { MARKET_DATA_SOURCE: "" }, "MarketSourceConfigError"],
  ["missing provider key", { HEULATRADE_MARKET_API_KEY: "" }, "MarketSourceConfigError"],
  ["http provider URL", { HEULATRADE_MARKET_API_BASE_URL: "http://build-check.invalid" }, "MarketSourceConfigError"],
  ["missing database URL", { DATABASE_URL: "" }, "AuthConfigError"],
  ["missing auth secret", { BETTER_AUTH_SECRET: "" }, "AuthConfigError"],
  ["short auth secret", { BETTER_AUTH_SECRET: "short" }, "AuthConfigError"],
  ["wrong auth origin", { BETTER_AUTH_URL: "https://wrong.invalid" }, "AuthConfigError"],
  ["staging with the production origin", { BETTER_AUTH_ENVIRONMENT: "staging" }, "AuthConfigError"],
  ["unknown deployment environment", { BETTER_AUTH_ENVIRONMENT: "preview" }, "AuthConfigError"],
  ["missing Google secret", { GOOGLE_CLIENT_SECRET: "" }, "AuthConfigError"],
  ["incomplete SMTP settings", { SMTP_HOST: "mail.invalid" }, "AuthConfigError"],
  ["dev auth bypass", { DEV_AUTH_BYPASS: "1" }, "AuthConfigError"],
];
let failed = false;
for (const [name, overrides, expected] of cases) {
  const result = spawnSync("bunx", ["next", "build"], { cwd: root, encoding: "utf8", env: { ...process.env, ...valid, ...overrides, NODE_ENV: "production" }, timeout: 120_000 });
  const output = `${result.stdout}\n${result.stderr}`;
  const ok = result.status !== 0 && output.includes(expected);
  console.log(`${ok ? "✓" : "✗"} build refused: ${name}`);
  if (!ok) { failed = true; console.error(output.slice(-1500)); }
}
process.exit(failed ? 1 : 0);
