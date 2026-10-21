import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

const BASE = { ENGINE_DATABASE_URL: "postgresql://engine:engine@127.0.0.1:5432/engine" };

describe("loadConfig", () => {
  it("leaves arjum off by default with a 600 budget and a 400 reserve once enabled", () => {
    expect(loadConfig(BASE).arjum).toBeNull();
    const config = loadConfig({ ...BASE, ENGINE_ARJUM_BASE_URL: "https://arjum.example.test/", ENGINE_ARJUM_API_KEY: "secret-key" });
    expect(config.arjum).toEqual({ baseUrl: "https://arjum.example.test", apiKey: "secret-key", dailyBudget: 600, reserve: 400, eodEnabled: false });
    expect(loadConfig({ ...BASE, ENGINE_ARJUM_BASE_URL: "https://a.test", ENGINE_ARJUM_API_KEY: "k", ENGINE_ARJUM_DAILY_BUDGET: "50", ENGINE_ARJUM_RESERVE: "0", ENGINE_ARJUM_EOD_ENABLED: "1" }).arjum)
      .toMatchObject({ dailyBudget: 50, reserve: 0, eodEnabled: true });
  });

  it("requires the arjum URL and key together and never echoes values", () => {
    expect(() => loadConfig({ ...BASE, ENGINE_ARJUM_API_KEY: "secret-key" })).toThrow(/ENGINE_ARJUM_BASE_URL and ENGINE_ARJUM_API_KEY/);
    expect(() => loadConfig({ ...BASE, ENGINE_ARJUM_BASE_URL: "ftp://x", ENGINE_ARJUM_API_KEY: "secret-key" })).toThrow(/http\(s\)/);
    try {
      loadConfig({ ...BASE, ENGINE_ARJUM_BASE_URL: "https://a.test", ENGINE_ARJUM_API_KEY: "secret-key", ENGINE_ARJUM_DAILY_BUDGET: "5000" });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).toContain("ENGINE_ARJUM_DAILY_BUDGET");
      expect(String(error)).not.toContain("secret-key");
    }
  });

  it("keeps intraday polling at one minute or slower", () => {
    expect(loadConfig(BASE).intraday.intervalMinutes).toBe(5);
    expect(() => loadConfig({ ...BASE, ENGINE_INTRADAY_INTERVAL_MINUTES: "0" })).toThrow(/ENGINE_INTRADAY_INTERVAL_MINUTES/);
  });

  it("polls news every 15 minutes (never under 5) and keeps it 180 days by default", () => {
    expect(loadConfig(BASE).news).toEqual({ intervalMinutes: 15, retentionDays: 180 });
    expect(loadConfig({ ...BASE, ENGINE_NEWS_INTERVAL_MINUTES: "30", ENGINE_NEWS_RETENTION_DAYS: "90" }).news).toEqual({ intervalMinutes: 30, retentionDays: 90 });
    expect(() => loadConfig({ ...BASE, ENGINE_NEWS_INTERVAL_MINUTES: "2" })).toThrow(/ENGINE_NEWS_INTERVAL_MINUTES/);
  });

  it("caps ownership uploads at 20 MB and keeps the free-float draft off by default", () => {
    expect(loadConfig(BASE).ownership).toEqual({ maxUploadBytes: 20 * 1024 * 1024, freeFloatEnabled: false });
    expect(loadConfig({ ...BASE, ENGINE_OWNERSHIP_MAX_UPLOAD_MB: "5", ENGINE_FREE_FLOAT_ENABLED: "1" }).ownership).toEqual({ maxUploadBytes: 5 * 1024 * 1024, freeFloatEnabled: true });
    expect(() => loadConfig({ ...BASE, ENGINE_OWNERSHIP_MAX_UPLOAD_MB: "500" })).toThrow(/ENGINE_OWNERSHIP_MAX_UPLOAD_MB/);
  });
});
