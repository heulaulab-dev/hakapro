import { describe, expect, test, vi } from "vitest";
import { historyResponseSchema } from "@/server/schemas/arjum";
import { ArjumClient } from "./client";
import { buildProviderUrl } from "./queries";

const valid = { stock_code: "BBCA", frame: "daily", rows: [] };

describe("ArjumClient", () => {
  test("sends the key only as a server-side header and builds query parameters", async () => {
    const fetcher = vi.fn(async () => Response.json(valid));
    const client = new ArjumClient({ baseUrl: "https://provider.test", apiKey: "test-key", fetcher });
    await client.get("/api/history/BBCA", historyResponseSchema, { frame: "daily", limit: 120 });
    expect(fetcher).toHaveBeenCalledWith("https://provider.test/api/history/BBCA?frame=daily&limit=120", expect.objectContaining({ headers: expect.objectContaining({ "x-api-key": "test-key" }) }));
  });

  test.each([[401, "PROVIDER_UNAUTHORIZED"], [403, "PROVIDER_UNAUTHORIZED"], [429, "RATE_LIMITED"], [500, "PROVIDER_UNAVAILABLE"]] as const)("maps HTTP %s to %s", async (status, code) => {
    const client = new ArjumClient({ baseUrl: "https://provider.test", apiKey: "k", fetcher: async () => new Response("{}", { status }) });
    await expect(client.get("/api/history/BBCA", historyResponseSchema)).rejects.toMatchObject({ code });
  });

  test("schema drift is MALFORMED_PROVIDER_RESPONSE", async () => {
    const client = new ArjumClient({ baseUrl: "https://provider.test", apiKey: "k", fetcher: async () => Response.json({ ...valid, rows: [{ close: "bad" }] }) });
    await expect(client.get("/api/history/BBCA", historyResponseSchema)).rejects.toMatchObject({ code: "MALFORMED_PROVIDER_RESPONSE" });
  });

  test("missing configuration is NOT_CONFIGURED", () => {
    expect(() => new ArjumClient({ baseUrl: "", apiKey: "" })).toThrow(expect.objectContaining({ code: "NOT_CONFIGURED" }));
  });
});

test("URL builder encodes paths and omits absent query values", () => {
  expect(buildProviderUrl("https://provider.test/", "/api/history/BB CA", { frame: "weekly", limit: 120, year: undefined, brokers: [] })).toBe("https://provider.test/api/history/BB%20CA?frame=weekly&limit=120");
});
