import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { resolveAuthConfig } from "./src/server/config/auth";
import { assertMarketSourceConfigured, resolveMarketDataSource } from "./src/server/config/market-source";
import { securityHeaders } from "./src/server/config/security-headers";

// `next typegen` loads this file in the production-build phase but only generates route types;
// every other command (build, start, dev) must pass the guards.
if (!process.argv.includes("typegen")) {
  // Fail `next build` / `next start` when production would run on fixtures or without auth.
  resolveMarketDataSource(process.env);
  assertMarketSourceConfigured(process.env);
  resolveAuthConfig(process.env);
}

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env) }];
  },
};

export default withNextIntl(nextConfig);
