import { afterEach, describe, expect, test, vi } from "vitest";
import { envelopeSchema } from "@/lib/api/envelope";
import { ownershipNetworkReplayClientSchema } from "@/lib/api/market";
import type { MarketDataSource } from "@/server/market/source";
import { OWNERSHIP_CHANGE_KINDS } from "@/lib/ownership/changes";

const state = vi.hoisted(() => ({ decision: "allow" as "allow" | "unauthorized", source: null as unknown }));
vi.mock("@/server/auth", () => ({ checkAccess: async () => state.decision }));
vi.mock("@/server/market", async (importOriginal) => ({ ...(await importOriginal<object>()), getMarketDataSource: () => state.source }));

const emptyData = {
  availability: "ENABLED" as const, months: ["2026-08"], month: "2026-08", snapshotDate: "2026-08-31", issuers: 0, holdings: 0,
  issuerRecords: [], rows: [], network: { nodes: [], edges: [], ambiguous: 0 },
  comparison: { status: "NO_PREVIOUS" as const, fromMonth: null, comparedIssuers: 0, statusCounts: { COMPARED: 0, NO_PREVIOUS: 0, NOT_ADJACENT: 0, REFUSED: 0 }, counts: Object.fromEntries(OWNERSHIP_CHANGE_KINDS.map((kind) => [kind, 0])) },
};
const request = (path: string) => new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}` } });

afterEach(() => { state.decision = "allow"; state.source = null; });

describe("GET /api/ownership/network", () => {
  test("requires an authorized session", async () => {
    state.decision = "unauthorized";
    const { GET } = await import("./route");
    expect((await GET(request("/api/ownership/network"))).status).toBe(401);
  });

  test("forwards the selected month and sends a private no-store envelope", async () => {
    const ownershipNetwork = vi.fn(async () => ({ data: emptyData, freshness: "HISTORICAL" as const, asOf: "2026-08-31", source: "idx-bei" }));
    state.source = { ownershipNetwork } as unknown as Partial<MarketDataSource>;
    const { GET } = await import("./route");
    const response = await GET(request("/api/ownership/network?month=2026-08"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(ownershipNetwork).toHaveBeenCalledWith({ month: "2026-08" });
    expect(envelopeSchema(ownershipNetworkReplayClientSchema).safeParse(await response.json()).success).toBe(true);
  });

  test("rejects malformed month values", async () => {
    const { GET } = await import("./route");
    expect((await GET(request("/api/ownership/network?month=2026-13"))).status).toBe(400);
  });
});
