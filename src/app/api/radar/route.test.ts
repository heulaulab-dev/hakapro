import { afterEach, describe, expect, test, vi } from "vitest";
import { BASELINE_DIR, wib } from "../../../../tests/support/fixtures";
import { envelopeSchema } from "@/lib/api/envelope";
import { radarSchema, stealthOwnershipSchema } from "@/lib/api/market";
import { RADAR_RULES_V0, RADAR_SIGNAL_KEYS, STEALTH_RULES_V0 } from "@/lib/radar/rules";
import { FixtureSource } from "@/server/market/fixture-source";
import type { MarketDataSource } from "@/server/market/source";

const state = vi.hoisted(() => ({ decision: "allow" as "allow" | "unauthorized", source: null as unknown }));
vi.mock("@/server/auth", () => ({ checkAccess: async () => state.decision }));
vi.mock("@/server/market", async (importOriginal) => ({ ...(await importOriginal<object>()), getMarketDataSource: () => state.source }));

const request = (path: string) => new Request(`http://localhost${path}`, { headers: { "x-forwarded-for": `10.1.0.${Math.floor(Math.random() * 250)}` } });
const radar = async () => (await import("./route")).GET(request("/api/radar"));
const stealth = async () => (await import("../ownership/stealth/route")).GET(request("/api/ownership/stealth"));

const zeros = Object.fromEntries(RADAR_SIGNAL_KEYS.map((key) => [key, 0]));
const rules = Object.fromEntries(RADAR_SIGNAL_KEYS.map((key) => {
  const { window, baseline, threshold, unit } = RADAR_RULES_V0.signals[key];
  return [key, { window, baseline, threshold, unit }];
}));

afterEach(() => {
  state.decision = "allow";
  state.source = null;
});

describe("GET /api/radar and /api/ownership/stealth", () => {
  test("fixture mode has no Data Engine: UNSUPPORTED, never an empty list dressed as data", async () => {
    state.source = new FixtureSource(() => wib("2026-10-21T17:00:00"), BASELINE_DIR);
    for (const response of [await radar(), await stealth()]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: "UNSUPPORTED", data: null, freshness: "UNAVAILABLE" });
    }
  });

  test("200 with the freshness envelope the client validates", async () => {
    state.source = {
      radar: async () => ({
        data: {
          tradingDate: "2026-10-16", rulesVersion: RADAR_RULES_V0.version, rules, kseiMonth: null,
          coverage: { stocks: 1, listed: 1, returned: 1, signals: zeros },
          stocks: [{
            symbol: "BBCA", name: "PT Bank Central Asia Tbk", sector: "Finance", close: 6200, changePercent: 0.16, value: 6e9,
            fired: [{ key: "volumeSpike", observed: 3, threshold: 2, window: "1D", detail: { volume: 3_000_000 } }],
            counter: [{ key: "priceVsForeign5", window: "5D", values: { priceChange: 0.008, foreignNetShares: -700_000 } }],
            firedCount: 1, status: Object.fromEntries(RADAR_SIGNAL_KEYS.map((key) => [key, "ok"])),
          }],
        },
        freshness: "EOD", asOf: "2026-10-16", source: "idx-bei",
      }),
      stealthOwnership: async () => ({
        data: {
          month: null, previousMonth: null, rulesVersion: STEALTH_RULES_V0.version,
          rules: { investorTypes: ["CP"], maxPriceChange: 0.01, maxCloseGapDays: 10 },
          coverage: { issuers: 0, corporateIncrease: 0, priceRose: 0, priceMissing: 0 }, stocks: [],
        },
        freshness: "UNAVAILABLE", asOf: null, source: "idx-bei",
      }),
    } as unknown as Partial<MarketDataSource>;
    const radarResponse = await radar();
    expect(radarResponse.status).toBe(200);
    expect(envelopeSchema(radarSchema).safeParse(await radarResponse.json()).success).toBe(true);
    const stealthResponse = await stealth();
    expect(stealthResponse.status).toBe(200);
    expect(envelopeSchema(stealthOwnershipSchema).parse(await stealthResponse.json())).toMatchObject({ freshness: "UNAVAILABLE", data: { month: null } });
  });

  test("401 when not signed in", async () => {
    state.decision = "unauthorized";
    expect((await radar()).status).toBe(401);
    expect((await stealth()).status).toBe(401);
  });
});
