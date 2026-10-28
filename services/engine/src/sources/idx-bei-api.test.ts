import { describe, expect, it } from "vitest";
import { IdxBeiApi, IDX_BEI_COMPANY_SNAPSHOT_PATH } from "./idx-bei-api";
import snapshotFixture from "./fixtures/idx-bei-company-snapshot.2026-08-26.json";
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

  it("reads the company snapshot from its fixed static path", async () => {
    const urls: string[] = [];
    const client = new IdxBeiApi({ enabled: true, baseUrl: "http://idx-bei:8000", fetch: async (url) => { urls.push(url); return Response.json(snapshotFixture); } });
    const read = await client.companySnapshot();
    expect(urls).toEqual([`http://idx-bei:8000${IDX_BEI_COMPANY_SNAPSHOT_PATH}`]);
    expect(read.ok && read.data.companies.length).toBe(5);
  });

  it("never touches the network for the snapshot while disabled", async () => {
    const client = new IdxBeiApi({ enabled: false, baseUrl: "http://idx-bei:8000", fetch: (() => { throw Error("network"); }) });
    expect(await client.companySnapshot()).toEqual({ ok: false, reason: "disabled" });
  });

  it("rejects non-JSON, oversized and schema-invalid snapshots without retrying them", async () => {
    let calls = 0;
    const respond = (response: () => Response) => new IdxBeiApi({ enabled: true, baseUrl: "http://idx-bei:8000", fetch: async () => { calls++; return response(); } });
    expect(await respond(() => new Response("<html/>", { headers: { "content-type": "text/html" } })).companySnapshot()).toEqual({ ok: false, reason: "not-json" });
    expect(await respond(() => new Response("{}", { headers: { "content-type": "application/json", "content-length": "99999999" } })).companySnapshot()).toEqual({ ok: false, reason: "too-large" });
    expect(await respond(() => Response.json({ last_updated: "soon", companies: [] })).companySnapshot()).toEqual({ ok: false, reason: "invalid-schema" });
    expect(await respond(() => new Response("{", { headers: { "content-type": "application/json" } })).companySnapshot()).toEqual({ ok: false, reason: "invalid-json" });
    expect(calls).toBe(4);
  });

  it("retries transient failures with exponential backoff and stops at the attempt limit", async () => {
    const waits: number[] = [];
    let calls = 0;
    const client = new IdxBeiApi({ enabled: true, baseUrl: "http://idx-bei:8000", maxAttempts: 3, backoffMs: 100, sleep: async (ms) => { waits.push(ms); },
      fetch: async () => { calls++; return new Response(null, { status: 503 }); } });
    expect(await client.companySnapshot()).toEqual({ ok: false, reason: "http-503" });
    expect(calls).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it("does not retry a 404", async () => {
    let calls = 0;
    const client = new IdxBeiApi({ enabled: true, baseUrl: "http://idx-bei:8000", maxAttempts: 3, sleep: async () => {}, fetch: async () => { calls++; return new Response(null, { status: 404 }); } });
    expect(await client.companySnapshot()).toEqual({ ok: false, reason: "http-404" });
    expect(calls).toBe(1);
  });

  it("opens the circuit after repeated failures, then probes again after the cooldown", async () => {
    let clock = 0;
    let calls = 0;
    let healthy = false;
    const client = new IdxBeiApi({ enabled: true, baseUrl: "http://idx-bei:8000", maxAttempts: 1, now: () => clock,
      fetch: async () => { calls++; return healthy ? Response.json(snapshotFixture) : new Response(null, { status: 502 }); } });
    for (let i = 0; i < 3; i++) await client.companySnapshot();
    expect(calls).toBe(3);
    expect(await client.companySnapshot()).toEqual({ ok: false, reason: "circuit-open" });
    expect(calls).toBe(3);
    clock += 5 * 60_000;
    healthy = true;
    expect((await client.companySnapshot()).ok).toBe(true);
    expect(calls).toBe(4);
  });

});
