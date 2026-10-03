// Imported by next.config.ts, so it must stay free of `server-only` and Next runtime imports.

export const MARKET_DATA_SOURCES = ["fixture", "arjum", "idx-bei"] as const;
export type MarketDataSourceId = (typeof MARKET_DATA_SOURCES)[number];

type Env = Record<string, string | undefined>;

export class MarketSourceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarketSourceConfigError";
  }
}

export function isProductionEnv(env: Env): boolean {
  return env.NODE_ENV === "production" || env.VERCEL_ENV === "production";
}

/**
 * Resolves MARKET_DATA_SOURCE. Outside production it defaults to recorded fixtures.
 * In production a missing value or "fixture" is a hard error, so neither `next build`
 * nor `next start` can run against fixture data.
 */
export function resolveMarketDataSource(env: Env): MarketDataSourceId {
  const raw = env.MARKET_DATA_SOURCE?.trim();
  if (raw && !(MARKET_DATA_SOURCES as readonly string[]).includes(raw)) {
    throw new MarketSourceConfigError(`MARKET_DATA_SOURCE must be one of ${MARKET_DATA_SOURCES.join(", ")}`);
  }
  const source = (raw || undefined) as MarketDataSourceId | undefined;
  if (isProductionEnv(env)) {
    if (!source) throw new MarketSourceConfigError("MARKET_DATA_SOURCE is required in production");
    if (source === "fixture") throw new MarketSourceConfigError("MARKET_DATA_SOURCE=fixture is not allowed in production");
    return source;
  }
  return source ?? "fixture";
}

export function isFixtureMode(env: Env): boolean {
  return resolveMarketDataSource(env) === "fixture";
}
