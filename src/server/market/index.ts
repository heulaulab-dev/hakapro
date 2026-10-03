import "server-only";
import { resolveMarketDataSource } from "@/server/config/market-source";
import { ArjumSource } from "./arjum-source";
import { MarketDataError } from "./errors";
import { FixtureSource } from "./fixture-source";
import { IdxBeiSource } from "./idx-bei-source";
import type { Capability, MarketDataSource } from "./source";

/**
 * Delegates each capability to the first source that supports it. An UNSUPPORTED error moves
 * on to the next source; any other error is surfaced as-is.
 */
export function compositeSource(sources: MarketDataSource[]): MarketDataSource {
  const id = sources.map((source) => source.id).join("+");
  return new Proxy({ id } as MarketDataSource, {
    get(target, property) {
      if (property === "id") return id;
      // Keep the proxy from looking like a thenable or exposing symbol-keyed internals.
      if (typeof property === "symbol" || property === "then") return undefined;
      return async (...args: unknown[]) => {
        let lastError: unknown = new MarketDataError("UNSUPPORTED", `No source provides ${String(property)}`, 503);
        for (const source of sources) {
          try {
            const method = source[property as Capability] as (...a: unknown[]) => Promise<unknown>;
            return await method.apply(source, args);
          } catch (error) {
            if (error instanceof MarketDataError && error.code === "UNSUPPORTED") { lastError = error; continue; }
            throw error;
          }
        }
        throw lastError;
      };
    },
  });
}

/** Lazily constructed sources: missing credentials surface as NOT_CONFIGURED per request, never at import. */
function lazy(id: string, create: () => MarketDataSource): MarketDataSource {
  let instance: MarketDataSource | null = null;
  return new Proxy({ id } as MarketDataSource, {
    get(_target, property) {
      if (property === "id") return id;
      // Keep the proxy from looking like a thenable or exposing symbol-keyed internals.
      if (typeof property === "symbol" || property === "then") return undefined;
      return async (...args: unknown[]) => {
        // create() throws NOT_CONFIGURED when credentials are missing; that error reaches the route as-is.
        instance ??= create();
        const method = instance[property as Capability] as (...a: unknown[]) => Promise<unknown>;
        return method.apply(instance, args);
      };
    },
  });
}

let cached: MarketDataSource | null = null;

export function getMarketDataSource(): MarketDataSource {
  if (cached) return cached;
  const mode = resolveMarketDataSource(process.env);
  if (mode === "fixture") cached = new FixtureSource();
  else if (mode === "idx-bei") cached = lazy("idx-bei", IdxBeiSource.fromEnv);
  // arjum first; idx-bei only fills capabilities arjum lacks, and only when MARKET_API_URL is set.
  else cached = compositeSource([lazy("arjum", ArjumSource.fromEnv), ...(process.env.MARKET_API_URL ? [lazy("idx-bei", IdxBeiSource.fromEnv)] : [])]);
  return cached;
}

export type { MarketDataSource } from "./source";
