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
  NEXT_PUBLIC_SUPABASE_URL: "https://build-check.invalid",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "build-check",
  DEV_AUTH_BYPASS: "",
};
const cases = [
  ["fixture data", { MARKET_DATA_SOURCE: "fixture" }, "MarketSourceConfigError"],
  ["missing data source", { MARKET_DATA_SOURCE: "" }, "MarketSourceConfigError"],
  ["missing provider key", { HEULATRADE_MARKET_API_KEY: "" }, "MarketSourceConfigError"],
  ["http provider URL", { HEULATRADE_MARKET_API_BASE_URL: "http://build-check.invalid" }, "MarketSourceConfigError"],
  ["missing Supabase URL", { NEXT_PUBLIC_SUPABASE_URL: "" }, "AuthConfigError"],
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
