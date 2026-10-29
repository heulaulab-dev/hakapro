import { afterEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ access: "allow" as "allow" | "unauthorized", query: null as Record<string, unknown> | null }));
vi.mock("@/server/auth", () => ({ checkAccess: async () => state.access }));
vi.mock("@/server/market", () => ({ getMarketDataSource: () => ({
  stockSectorRotation: async (query: Record<string, unknown>) => {
    state.query = query;
    return { data: { sector: query.sector, interval: query.interval ?? "weekly", stocks: [] }, source: "idx-bei", asOf: "2026-10-28", freshness: "EOD" };
  },
}) }));

afterEach(() => { state.access = "allow"; state.query = null; });

async function get(query = "") {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/sector-rotation/stocks${query}`, { headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` } }));
}

describe("GET /api/sector-rotation/stocks", () => {
  test("requires an authorized app session", async () => {
    state.access = "unauthorized";
    const response = await get("?sector=Energy");
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("UNAUTHORIZED");
  });

  test("validates the required sector and applies bounded defaults", async () => {
    const response = await get("?sector=Energy");
    expect(response.status).toBe(200);
    expect(state.query).toEqual({ sector: "Energy", interval: undefined });
    expect((await response.json()).data.sector).toBe("Energy");
  });

  test("rejects invalid window, interval, and empty sector", async () => {
    for (const query of ["?sector=Energy&interval=hourly", "?sector="]) {
      const response = await get(query);
      expect(response.status, query).toBe(400);
      expect((await response.json()).error, query).toBe("INVALID_REQUEST");
    }
  });
});
