// /v1/groups against a throwaway PostgreSQL (Docker): securities, daily_prices and corporate_actions seeded directly,
// then the DB store's window queries (sessionDates, dailyRowsBetween, closesBefore, actionsBetween) through the HTTP app
// and the shared schema. Opt-in (`bun run engine:test:e2e`); skipped in `bun run test` and CI. No request leaves the
// machine.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { groupsSchema, idxBeiEnvelope } from "@/server/schemas/idx-bei";
import * as t from "../db/schema";
import { loadConfig } from "../src/config";
import { createEngine } from "../src/engine";
import { nullLogger } from "../src/log";
import { dockerEnabled, startPostgres, type TestPostgres } from "./postgres";
import { tempDir, wib } from "./support";

const enabled = dockerEnabled();
const refuse = (async (input: string | URL | Request) => { throw new Error(`network refused in e2e: ${String(input)}`); }) as unknown as typeof fetch;
const DATES = ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];

describe.skipIf(!enabled)("conglomerate groups (docker postgres)", () => {
  let pg: TestPostgres;
  let cleanup: (() => Promise<void>) | undefined;
  let call: (path: string) => Promise<Response>;

  beforeAll(async () => {
    pg = await startPostgres();
    const url = await pg.createDatabase("groups_1");
    const dir = await tempDir("engine-groups-");
    const config = loadConfig({ ENGINE_DATABASE_URL: url, ENGINE_DATA_DIR: dir.path, ENGINE_DISK_STOP_PERCENT: "100" });
    const engine = await createEngine(config, { fetch: refuse, log: nullLogger, now: () => wib("2026-10-16", "19:30") });
    cleanup = async () => { await engine.shutdown(); await dir.cleanup(); };
    call = (path) => engine.app(new Request(`http://engine.test${path}`));

    const db = engine.services.db;
    const asOf = new Date("2026-10-16T09:35:00Z");
    await db.insert(t.securities).values([
      ...["BBCA", "TOWR", "TLKM", "MTEL"].map((symbol) => ({ symbol, name: `${symbol} Tbk`, active: true, source: "test-fixture", asOf })),
      { symbol: "BELI", name: "BELI Tbk", active: false, source: "test-fixture", asOf },
    ]);
    const closes: Record<string, number[]> = { BBCA: [6000, 6100, 6200, 6300, 6400, 6600], TOWR: [700, 700, 690, 680, 670, 660], TLKM: [3000, 3000, 3000, 600, 610, 620], MTEL: [600, 600, 610, 620, 630, 640] };
    await db.insert(t.dailyPrices).values(Object.entries(closes).flatMap(([symbol, series]) => series.map((close, index) => ({
      symbol, date: DATES[index], close, previousClose: index ? series[index - 1] : null, value: 1_000_000_000,
      // BBCA: foreign net sellers every session while the price rises.
      ...(symbol === "BBCA" ? { foreignBuy: 1_000, foreignSell: 3_000 } : {}),
      source: "test-fixture", asOf,
    }))));
    await db.insert(t.corporateActions).values({ symbol: "TLKM", type: "SPLIT", exDate: "2026-10-14", ratio: "1:5", description: "Stock split 1:5", source: "test-fixture", asOf });
  }, 120_000);

  afterAll(async () => {
    await cleanup?.();
    pg?.stop();
  }, 60_000);

  const groups = async (window: string) => {
    const response = await call(`/v1/groups?window=${window}`);
    expect(response.status).toBe(200);
    return idxBeiEnvelope(groupsSchema).parse(await response.json());
  };

  it("1D: the newest session, value-weighted, with the foreign estimate and the divergence stated", async () => {
    const body = await groups("1D");
    expect(body.meta).toMatchObject({ dataAsOf: "2026-10-16", freshness: "EOD" });
    const djarum = body.data.groups.find((group) => group.id === "djarum")!;
    expect(djarum).toMatchObject({ membersWithData: 2, inactiveSymbols: ["BELI"], unknownSymbols: ["RANC"], foreign: { members: 1, partialMembers: 0, netValueEstimate: -2_000 * 6600 } });
    expect(djarum.valueWeightedChangePercent).toBeCloseTo((6600 / 6400 - 1 + (660 / 670 - 1)) / 2, 10);
    expect(djarum.divergence).toBe("price_up_foreign_net_sell");
  });

  it("5D: from the close before the window, split members left out of the change", async () => {
    const body = await groups("5D");
    expect(body.data.window).toEqual({ id: "5D", sessions: 5, from: "2026-10-12", to: "2026-10-16", basis: "daily" });
    const djarum = body.data.groups.find((group) => group.id === "djarum")!;
    const bbca = djarum.stocks.find((stock) => stock.symbol === "BBCA")!;
    expect(bbca.changePercent).toBeCloseTo(6600 / 6000 - 1, 10);
    expect(bbca).toMatchObject({ sessions: 5, foreignSessions: 5, netForeignValueEstimate: -2_000 * (6100 + 6200 + 6300 + 6400 + 6600) });
    const telco = body.data.groups.find((group) => group.id === "bumn-telco")!;
    expect(telco.stocks.find((stock) => stock.symbol === "TLKM")).toMatchObject({ corporateAction: true, changePercent: null });
    expect(telco.changePercent).toBeCloseTo(640 / 600 - 1, 10);
    expect(telco.foreign).toEqual({ netValueEstimate: null, members: 0, partialMembers: 0 });
  });

  it("20D caps at the stored sessions; a bad window is a 400", async () => {
    expect((await groups("20D")).data.window).toMatchObject({ sessions: 6, from: "2026-10-09", to: "2026-10-16" });
    expect((await call("/v1/groups?window=3D")).status).toBe(400);
  });
});
