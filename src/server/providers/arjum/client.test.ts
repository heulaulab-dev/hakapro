import { describe, expect, test, vi } from "vitest";
import { historyResponseSchema } from "@/server/schemas/arjum";
import { PROVIDER_USER_AGENT } from "@/server/config/provider-identity";
import { ProviderBackoff } from "../backoff";
import { ArjumClient } from "./client";
import { buildProviderUrl } from "./queries";

const valid = { stock_code: "BBCA", frame: "daily", rows: [] };

describe("ArjumClient", () => {
  test("sends the key only as a server-side header and builds query parameters", async () => {
    const fetcher = vi.fn(async () => Response.json(valid));
    const client = new ArjumClient({ baseUrl: "https://provider.test", apiKey: "test-key", fetcher, backoff: new ProviderBackoff() });
    await client.get("/api/history/BBCA", historyResponseSchema, { frame: "daily", limit: 120 });
    expect(fetcher).toHaveBeenCalledWith("https://provider.test/api/history/BBCA?frame=daily&limit=120", expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "test-key", "user-agent": PROVIDER_USER_AGENT }) }));
  });

  test.each([[401, "PROVIDER_UNAUTHORIZED"], [403, "PROVIDER_UNAUTHORIZED"], [422, "INVALID_REQUEST"], [400, "INVALID_REQUEST"], [429, "RATE_LIMITED"], [500, "PROVIDER_UNAVAILABLE"]] as const)("maps HTTP %s to %s", async (status, code) => {
    const client = new ArjumClient({ baseUrl: "https://provider.test", apiKey: "k", fetcher: async () => new Response("{}", { status }), backoff: new ProviderBackoff() });
    await expect(client.get("/api/history/BBCA", historyResponseSchema)).rejects.toMatchObject({ code });
  });

  test("schema drift is MALFORMED_PROVIDER_RESPONSE", async () => {
    const client = new ArjumClient({ baseUrl: "https://provider.test", apiKey: "k", fetcher: async () => Response.json({ ...valid, rows: [{ close: "bad" }] }), backoff: new ProviderBackoff() });
    await expect(client.get("/api/history/BBCA", historyResponseSchema)).rejects.toMatchObject({ code: "MALFORMED_PROVIDER_RESPONSE" });
  });

  test("after a 429 it backs off: no request is sent until the cooldown (Retry-After, min 60 s) has passed", async () => {
    let now = 0;
    const backoff = new ProviderBackoff(() => now);
    const fetcher = vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "120" } }));
    const client = new ArjumClient({ baseUrl: "https://provider.test", apiKey: "k", fetcher, backoff });
    await expect(client.get("/api/history/BBCA", historyResponseSchema)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 120 });
    now = 119_000;
    await expect(client.get("/api/history/BBCA", historyResponseSchema)).rejects.toMatchObject({ code: "RATE_LIMITED", retryAfterSeconds: 1 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    now = 120_000;
    fetcher.mockImplementationOnce(async () => Response.json(valid));
    await expect(client.get("/api/history/BBCA", historyResponseSchema)).resolves.toMatchObject({ stock_code: "BBCA" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("a 429 without Retry-After still waits the 60 s minimum", async () => {
    let now = 0;
    const backoff = new ProviderBackoff(() => now);
    const client = new ArjumClient({ baseUrl: "https://provider.test", apiKey: "k", fetcher: async () => new Response("{}", { status: 429 }), backoff });
    await expect(client.get("/api/history/BBCA", historyResponseSchema)).rejects.toMatchObject({ retryAfterSeconds: 60 });
    now = 59_000;
    await expect(client.get("/api/history/BBCA", historyResponseSchema)).rejects.toMatchObject({ retryAfterSeconds: 1 });
  });

  test("missing configuration is NOT_CONFIGURED", () => {
    expect(() => new ArjumClient({ baseUrl: "", apiKey: "" })).toThrow(expect.objectContaining({ code: "NOT_CONFIGURED" }));
  });
});

test("URL builder encodes paths and omits absent query values", () => {
  expect(buildProviderUrl("https://provider.test/", "/api/history/BB CA", { frame: "weekly", limit: 120, year: undefined, brokers: [] })).toBe("https://provider.test/api/history/BB%20CA?frame=weekly&limit=120");
});
