import { describe, expect, test } from "vitest";
import { isFixtureMode, MarketSourceConfigError, resolveMarketDataSource } from "./market-source";

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
