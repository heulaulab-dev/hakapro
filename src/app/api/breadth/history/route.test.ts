import { afterEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ access: "allow" as "allow" | "unauthorized", window: null as string | null }));
vi.mock("@/server/auth", () => ({ checkAccess: async () => state.access }));
vi.mock("@/server/market", () => ({ getMarketDataSource: () => ({
  breadthHistory: async (window: string) => {
    state.window = window;
    return {
      data: { window, snapshotDate: "2026-10-28", source: "daily_prices", freshness: "EOD", series: [] },
      source: "idx-bei", asOf: "2026-10-28", freshness: "EOD",
    };
  },
}) }));

afterEach(() => { state.access = "allow"; state.window = null; });

async function get(query = "") {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/breadth/history${query}`, { headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` } }));
}

describe("GET /api/breadth/history", () => {
  test("requires an authorized app session", async () => {
    state.access = "unauthorized";
    const response = await get("?window=3M");
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("UNAUTHORIZED");
  });

  test("defaults to three months and passes the selected window to the data source", async () => {
    const defaultResponse = await get();
    expect(defaultResponse.status).toBe(200);
    expect((await defaultResponse.json()).data.window).toBe("3M");
    expect(state.window).toBe("3M");

    const response = await get("?window=6m");
    expect(response.status).toBe(200);
    expect((await response.json()).data.window).toBe("6M");
    expect(state.window).toBe("6M");
  });

  test("rejects unsupported windows", async () => {
    const response = await get("?window=10Y");
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("INVALID_REQUEST");
    expect(state.window).toBeNull();
  });
});
