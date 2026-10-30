import { afterEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ access: "allow" as "allow" | "unauthorized", calls: 0 }));
vi.mock("@/server/auth", () => ({ checkAccess: async () => state.access }));
vi.mock("@/server/market", () => ({ getMarketDataSource: () => ({
  foreignFlowPulse: async () => {
    state.calls += 1;
    return {
      data: {
        date: "2026-10-29", coverage: { priced: 800, observed: 640, ratio: 0.8 },
        totals: { netBuyers: 320, netSellers: 290, unchanged: 30, netShares: 1_200_000, netValueIdrEstimate: 14_000_000_000 },
        sectors: [], history: [],
      },
      source: "idx-bei", asOf: "2026-10-29", freshness: "EOD",
    };
  },
}) }));

afterEach(() => { state.access = "allow"; state.calls = 0; });

async function get() {
  const { GET } = await import("./route");
  return GET(new Request("http://localhost/api/foreign-flow/pulse", { headers: { "x-forwarded-for": `10.0.1.${Math.floor(Math.random() * 250)}` } }));
}

describe("GET /api/foreign-flow/pulse", () => {
  test("requires an authorized app session", async () => {
    state.access = "unauthorized";
    const response = await get();
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("UNAUTHORIZED");
    expect(state.calls).toBe(0);
  });

  test("returns the Engine summary and its data freshness", async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { date: "2026-10-29", coverage: { priced: 800, observed: 640 } }, source: "idx-bei", asOf: "2026-10-29", freshness: "EOD" });
    expect(response.headers.get("cache-control")).toBe("private, max-age=300");
  });
});
