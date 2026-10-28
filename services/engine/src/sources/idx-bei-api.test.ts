import { describe, expect, it } from "vitest";
import { IdxBeiApi } from "./idx-bei-api";
const partition = { total_dates: 0, start_date: null, end_date: null };
const inventory = { status: "warning", health_score: 55, inventory: { timeseries: { stock_summary: partition, broker_summary: partition, index_summary: partition } } };
describe("IDX-BEI read-only integration", () => {
  it("disabled means no network activity", async () => {
    const client = new IdxBeiApi({ enabled: false, baseUrl: "http://idx-bei:8000", fetch: (() => { throw Error("network"); }) });
    expect((await client.inventory()).status).toBe("DISABLED");
  });
  it("validates records and keeps the last good response on failure", async () => {
    let ok = true;
    const client = new IdxBeiApi({ enabled: true, baseUrl: "http://idx-bei:8000", fetch: (async () => ok ? Response.json(inventory) : Response.json({ invalid: true })) });
    expect((await client.inventory()).status).toBe("AVAILABLE");
    ok = false;
    const result = await client.inventory();
    expect(result.status).toBe("STALE");
    expect(result.data).toEqual(inventory);
  });
  it("does not retry authentication failures", async () => {
    let requests = 0;
    const client = new IdxBeiApi({ enabled: true, baseUrl: "http://idx-bei:8000", fetch: (async () => { requests++; return new Response(null, { status: 401 }); }) });
    expect((await client.inventory()).status).toBe("UNAVAILABLE");
    expect(requests).toBe(1);
  });
  it("rejects credentials and URL query overrides", () => {
    expect(() => new IdxBeiApi({ enabled: true, baseUrl: "http://user:pass@idx-bei:8000" })).toThrow();
    expect(() => new IdxBeiApi({ enabled: true, baseUrl: "http://idx-bei:8000/?url=other" })).toThrow();
  });
  it("retries a transient status once and validates the fixed read path", async () => {
    let calls = 0;
    const client = new IdxBeiApi({ enabled: true, baseUrl: "http://idx-bei:8000", fetch: async (url, init) => {
      expect(url).toBe("http://idx-bei:8000/api/system/ingestion-status");
      expect(init.redirect).toBe("error");
      calls++;
      return calls === 1 ? new Response(null, { status: 503 }) : Response.json(inventory);
    } });
    expect((await client.inventory()).status).toBe("AVAILABLE");
    expect(calls).toBe(2);
  });
  it("turns timeout into unavailable without propagating an error", async () => {
    const client = new IdxBeiApi({ enabled: true, baseUrl: "http://idx-bei:8000", timeoutMs: 1, fetch: async (_url, init) => {
      await new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true }));
      return Response.json(inventory);
    } });
    expect((await client.inventory()).status).toBe("UNAVAILABLE");
  });

});
