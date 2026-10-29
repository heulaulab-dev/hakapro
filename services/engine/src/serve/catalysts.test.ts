import { describe, expect, it } from "vitest";
import { serveCatalysts } from "./catalysts";
import { MemoryMarketStore } from "./store";

const now = new Date("2026-10-29T00:00:00Z");
describe("catalyst radar", () => {
  it("combines independent stored datasets newest first", async () => {
    const result = await serveCatalysts(new MemoryMarketStore({
      news: [{ publishedAt: new Date("2026-10-28T10:00:00Z"), publishedAtEstimated: false, title: "BBCA expands", url: "https://example.test/1", outlet: "Test", summary: null, symbols: ["BBCA"] }],
      actions: [{ symbol: "BBCA", exDate: "2026-10-27", type: "DIVIDEND", description: "Cash", asOf: new Date("2026-10-27T00:00:00Z") }],
      issuerProfiles: [{ symbol: "BBCA", language: "id-id", profile: {}, directors: [], commissioners: [], auditCommittee: [], shareholders: [], subsidiaries: [], retrievedAt: new Date("2026-10-26T00:00:00Z") }],
    }), "BBCA", now);
    expect(result.data.events.map((event) => event.kind)).toEqual(["NEWS", "ACTION", "PROFILE"]);
    expect(result.data.available).toBe(true);
  });
  it("returns an honest unavailable payload with no source rows", async () => {
    const result = await serveCatalysts(new MemoryMarketStore(), "BBCA", now);
    expect(result.data).toEqual({ symbol: "BBCA", events: [], available: false });
    expect(result.freshness).toBe("UNAVAILABLE");
  });
});
