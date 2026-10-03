import type { NextConfig } from "next";
import { resolveMarketDataSource } from "./src/server/config/market-source";

// Fails `next build` and `next start` when production would run on fixtures.
resolveMarketDataSource(process.env);

const nextConfig: NextConfig = {};

export default nextConfig;
