import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const admin = vi.hoisted(() => ({ allowed: true }));
vi.mock("@/server/admin", () => ({
  isAdmin: async () => admin.allowed,
  engineAdmin: () => (process.env.ENGINE_ADMIN_TOKEN ? { baseUrl: "http://engine.test", token: process.env.ENGINE_ADMIN_TOKEN } : null),
}));

const upload = {
  id: "0b6c2f0e-7a2c-4b6e-9a51-1f1f8f0b3c11", receivedAt: "2026-10-21T08:00:00.000Z", asOfMonth: "2026-09", snapshotDate: null, sourceLabel: "No. Peng-00001/BEI",
  fileName: "list.pdf", format: "pdf", contentType: "application/pdf", byteSize: 5, sha256: "a".repeat(64), status: "PARSED", error: null, issues: [],
  stats: { issuers: 3, rowsAccepted: 12 }, parsedAt: "2026-10-21T08:00:01.000Z",
};
const pdf = () => new File([new Uint8Array([37, 80, 68, 70, 45])], "list.pdf", { type: "application/pdf" });
const post = (form: FormData, origin = "http://localhost") => new Request("http://localhost/api/admin/ownership/uploads", { method: "POST", body: form, headers: { origin } });

describe("/api/admin/ownership/uploads", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    admin.allowed = true;
    process.env.ENGINE_ADMIN_TOKEN = "engine-admin-token";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.ENGINE_ADMIN_TOKEN; });

  test("non-admins get a plain 404 and the engine is never called", async () => {
    admin.allowed = false;
    const { GET, POST } = await import("./route");
    expect((await GET(new Request("http://localhost/api/admin/ownership/uploads"))).status).toBe(404);
    const form = new FormData(); form.set("file", pdf()); form.set("asOf", "2026-09");
    expect((await POST(post(form))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("forwards the file, month and reference to the engine with the admin token", async () => {
    fetchMock.mockResolvedValue(Response.json({ data: upload }, { status: 201 }));
    const { POST } = await import("./route");
    const form = new FormData(); form.set("file", pdf()); form.set("asOf", "2026-09"); form.set("source", "No. Peng-00001/BEI");
    const response = await POST(post(form));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ data: { status: "PARSED", stats: { issuers: 3 } }, duplicate: false });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://engine.test/v1/admin/ownership/upload");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer engine-admin-token");
    const sent = init.body as FormData;
    expect([sent.get("asOf"), sent.get("source"), (sent.get("file") as File).name]).toEqual(["2026-09", "No. Peng-00001/BEI", "list.pdf"]);
  });

  test("refuses cross-site posts, bad files and months, and reports a missing engine config", async () => {
    const { POST } = await import("./route");
    const ok = () => { const form = new FormData(); form.set("file", pdf()); form.set("asOf", "2026-09"); return form; };
    expect((await POST(post(ok(), "https://evil.example"))).status).toBe(403);
    const exe = new FormData(); exe.set("file", new File(["x"], "list.exe")); exe.set("asOf", "2026-09");
    expect((await POST(post(exe))).status).toBe(400);
    const badMonth = new FormData(); badMonth.set("file", pdf()); badMonth.set("asOf", "2026-9");
    expect((await POST(post(badMonth))).status).toBe(400);
    delete process.env.ENGINE_ADMIN_TOKEN;
    expect((await POST(post(ok()))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("passes the engine's rejection code through", async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: "PARSE_FAILED", message: "No ownership table found" } }, { status: 422 }));
    const { POST } = await import("./route");
    const form = new FormData(); form.set("file", pdf()); form.set("asOf", "2026-09");
    const response = await POST(post(form));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "PARSE_FAILED", message: "No ownership table found" });
  });
});
