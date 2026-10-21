import { afterEach, describe, expect, test, vi } from "vitest";
import { BASELINE_DIR, wib } from "../../../../../tests/support/fixtures";
import { researchBriefSchema } from "@/lib/api/research";
import { FixtureSource } from "@/server/market/fixture-source";
import { clearResearchCache } from "@/server/services/research-brief";

const access = vi.hoisted(() => ({ decision: "allow" as "allow" | "unauthorized" }));
const source = new FixtureSource(() => wib("2026-10-21T17:00:00"), BASELINE_DIR);
vi.mock("@/server/auth", () => ({ checkAccess: async () => access.decision }));
vi.mock("@/server/market", async (importOriginal) => ({ ...(await importOriginal<object>()), getMarketDataSource: () => source }));

async function get(code: string, query = "") {
  const { GET } = await import("./route");
  return GET(new Request(`http://localhost/api/research/${code}${query}`, { headers: { "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}` } }), { params: Promise.resolve({ code }) });
}

afterEach(() => {
  access.decision = "allow";
  clearResearchCache();
});

describe("GET /api/research/[code]", () => {
  test("200: the brief without a score, matching the client contract", async () => {
    const response = await get("BBCA", "?lang=en&days=30");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(researchBriefSchema.safeParse(body).success).toBe(true);
    expect(body.score).toMatchObject({ value: null, version: "none" });
    expect(body.code).toBe("BBCA");
  });

  test("401 when not signed in", async () => {
    access.decision = "unauthorized";
    const response = await get("BBCA");
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("UNAUTHORIZED");
  });

  test("404 for an unknown or malformed ticker", async () => {
    expect((await get("ZZZZ")).status).toBe(404);
    expect((await get("not-a-code")).status).toBe(404);
  });

  test("503 data_unavailable with the missing component names when the price is unavailable", async () => {
    // BANK is a known ticker (search) with no recorded price or history.
    const response = await get("BANK");
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toBe("data_unavailable");
    expect(body.missing).toEqual(["price", "momentum", "foreign", "volume", "ksei"]);
    // Missing names are component keys, never internal job or table names.
    expect(JSON.stringify(body)).not.toMatch(/fixture|arjum|idx-bei|job/i);
  });

  test("400 for an invalid query", async () => {
    expect((await get("BBCA", "?days=abc")).status).toBe(400);
    expect((await get("BBCA", "?lang=fr")).status).toBe(400);
  });
});
