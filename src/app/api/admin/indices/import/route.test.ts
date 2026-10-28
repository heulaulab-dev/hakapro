import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/server/admin", () => ({
  engineAdmin: () => process.env.ENGINE_ADMIN_TOKEN ? { baseUrl: "http://engine.internal", token: process.env.ENGINE_ADMIN_TOKEN } : null,
}));

const record = () => {
  const codes = ["COMPOSITE", "IDXENERGY", "IDXBASIC", "IDXINDUST", "IDXNONCYC", "IDXCYCLIC", "IDXHEALTH", "IDXFINANCE", "IDXPROPERT", "IDXTECHNO", "IDXINFRA", "IDXTRANS"];
  const rows = codes.map((IndexCode) => ({ IndexCode, Date: "2026-10-26T00:00:00", Close: 100 }));
  return { date: "2026-10-26", body: { recordsTotal: rows.length, recordsFiltered: rows.length, data: rows } };
};
const request = (payload: unknown, token = "engine-admin-token") => new Request("https://hakapro.id/api/admin/indices/import", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(payload),
});

describe("/api/admin/indices/import", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.ENGINE_ADMIN_TOKEN = "engine-admin-token";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.ENGINE_ADMIN_TOKEN; });

  test("authenticates and proxies one validated date envelope to the private engine", async () => {
    fetchMock.mockResolvedValue(Response.json({ data: { date: "2026-10-26", received: 12, rejected: 0, stored: 12 } }));
    const { POST } = await import("./route");
    const response = await POST(request(record()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { date: "2026-10-26", received: 12, rejected: 0, stored: 12 } });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://engine.internal/v1/admin/indices/import");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer engine-admin-token");
    expect(JSON.parse(String(init.body))).toEqual(record());
    expect(init.cache).toBe("no-store");
  });

  test("rejects bad bearer, invalid dates, and over-limit payloads before proxying", async () => {
    const { POST } = await import("./route");
    expect((await POST(request(record(), "wrong-token"))).status).toBe(401);
    expect((await POST(request({ ...record(), date: "2026-02-30" }))).status).toBe(400);
    const oversized = new Request("https://hakapro.id/api/admin/indices/import", {
      method: "POST", headers: { authorization: "Bearer engine-admin-token", "content-length": "4000001" }, body: "{}",
    });
    expect((await POST(oversized)).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does not turn engine errors into successful imports", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: "INVALID_IDX_RESPONSE" } }, { status: 422 }));
    const { POST } = await import("./route");
    const response = await POST(request(record()));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: { code: "INVALID_IDX_RESPONSE" } });
  });
});
