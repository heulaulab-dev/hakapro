import { describe, expect, test } from "vitest";
import { assertMarketSourceConfigured, isFixtureMode, MarketSourceConfigError, resolveMarketDataSource } from "./market-source";

describe("MARKET_DATA_SOURCE production guard", () => {
  test.each([
    [{ NODE_ENV: "production" }],
    [{ NODE_ENV: "production", MARKET_DATA_SOURCE: "" }],
    [{ NODE_ENV: "production", MARKET_DATA_SOURCE: "fixture" }],
    [{ NODE_ENV: "development", VERCEL_ENV: "production" }],
    [{ VERCEL_ENV: "production", MARKET_DATA_SOURCE: "fixture" }],
  ])("rejects %o", (env) => {
    expect(() => resolveMarketDataSource(env)).toThrow(MarketSourceConfigError);
  });

  test.each(["arjum", "idx-bei"] as const)("accepts %s in production", (source) => {
    expect(resolveMarketDataSource({ NODE_ENV: "production", MARKET_DATA_SOURCE: source })).toBe(source);
    expect(resolveMarketDataSource({ VERCEL_ENV: "production", MARKET_DATA_SOURCE: source })).toBe(source);
  });

  test("defaults to fixtures outside production", () => {
    expect(resolveMarketDataSource({ NODE_ENV: "development" })).toBe("fixture");
    expect(resolveMarketDataSource({ NODE_ENV: "test", VERCEL_ENV: "preview" })).toBe("fixture");
    expect(isFixtureMode({ NODE_ENV: "development" })).toBe(true);
    expect(isFixtureMode({ NODE_ENV: "development", MARKET_DATA_SOURCE: "arjum" })).toBe(false);
  });

  test("rejects unknown sources everywhere", () => {
    expect(() => resolveMarketDataSource({ NODE_ENV: "development", MARKET_DATA_SOURCE: "mock" })).toThrow(MarketSourceConfigError);
  });
});

describe("production source credentials", () => {
  const ARJUM = { NODE_ENV: "production", MARKET_DATA_SOURCE: "arjum", HEULATRADE_MARKET_API_BASE_URL: "https://provider.example", HEULATRADE_MARKET_API_KEY: "k" };
  test("complete arjum config passes; optional idx-bei must be https", () => {
    expect(() => assertMarketSourceConfigured(ARJUM)).not.toThrow();
    expect(() => assertMarketSourceConfigured({ ...ARJUM, MARKET_API_URL: "https://market.example" })).not.toThrow();
    expect(() => assertMarketSourceConfigured({ ...ARJUM, MARKET_API_URL: "http://10.0.0.1:8100" })).toThrow(/https/);
  });
  test("MARKET_API_URL may be plain http only to an internal service name", () => {
    for (const url of ["http://hp7pevthvpqki0eyqxkqpwu4:8080", "http://hakapro-engine:8080/"]) {
      expect(() => assertMarketSourceConfigured({ ...ARJUM, MARKET_API_URL: url })).not.toThrow();
      expect(() => assertMarketSourceConfigured({ NODE_ENV: "production", MARKET_DATA_SOURCE: "idx-bei", MARKET_API_URL: url })).not.toThrow();
    }
    for (const url of ["http://engine.example.com", "http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080", "ftp://engine"]) {
      expect(() => assertMarketSourceConfigured({ ...ARJUM, MARKET_API_URL: url }), url).toThrow(/https/);
    }
    // The arjum provider is outside the server and stays https-only.
    expect(() => assertMarketSourceConfigured({ ...ARJUM, HEULATRADE_MARKET_API_BASE_URL: "http://arjum:8080" })).toThrow(/https/);
  });
  test.each([
    [{ ...ARJUM, HEULATRADE_MARKET_API_KEY: "" }, /KEY is required/],
    [{ ...ARJUM, HEULATRADE_MARKET_API_BASE_URL: undefined }, /BASE_URL is required/],
    [{ ...ARJUM, HEULATRADE_MARKET_API_BASE_URL: "http://provider.example" }, /https/],
    [{ NODE_ENV: "production", MARKET_DATA_SOURCE: "idx-bei" }, /MARKET_API_URL is required/],
  ])("rejects %o", (env, message) => {
    expect(() => assertMarketSourceConfigured(env)).toThrow(message);
  });
  test("development never requires credentials", () => {
    expect(() => assertMarketSourceConfigured({ NODE_ENV: "development", MARKET_DATA_SOURCE: "arjum" })).not.toThrow();
  });
});
