// The insider feed (arjum /api/insiders, `insider-feed` job, /v1/insiders/recent) against a throwaway PostgreSQL
// (Docker) and the local fixture world. Opt-in (`bun run engine:test:e2e`); arjum is a fake and no request leaves the machine.
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { idxBeiEnvelope, insidersRecentSchema } from "@/server/schemas/idx-bei";
import * as t from "../db/schema";
import { loadConfig } from "../src/config";
import { createEngine } from "../src/engine";
import { ENGINE_USER_AGENT } from "../src/fetch/fetcher";
import { LimiterRegistry } from "../src/fetch/rate-limit";
import { nullLogger } from "../src/log";
import { dockerEnabled, startPostgres, type TestPostgres } from "./postgres";
import { ARJUM_TEST_KEY, ARJUM_TEST_ORIGIN, startSourceWorld, type SourceWorld } from "./source-fixtures";
import { fakeClock, tempDir, wib } from "./support";

const enabled = dockerEnabled();
/** Foreign flow keeps 500 of the 600 calls the default reserve (400) leaves; the insider feed gets the other 100 or less. */
const FEED = { ENGINE_ARJUM_DAILY_BUDGET: "500", ENGINE_ARJUM_INSIDER_BUDGET: "3" };

describe.skipIf(!enabled)("engine insider feed (docker postgres + fixtures)", { timeout: 30_000 }, () => {
  let pg: TestPostgres;
  let world: SourceWorld;
  const cleanups: Array<() => Promise<void>> = [];
  let counter = 0;

  beforeAll(async () => {
    pg = await startPostgres();
    world = await startSourceWorld();
  }, 120_000);

  afterAll(async () => {
    for (const cleanup of cleanups) await cleanup();
    await world?.close();
    pg?.stop();
  });

  beforeEach(() => {
    world.hits.length = 0;
    world.state.blocked.clear();
    world.state.arjumRemaining = 1000;
    world.state.insidersUpdate = false;
  });

  async function harness(env: Record<string, string> = {}) {
    const url = await pg.createDatabase(`insiders_${++counter}`);
    const dir = await tempDir("engine-insiders-");
    let now = wib("2026-10-16", "16:40");
    const config = loadConfig({
      ENGINE_DATABASE_URL: url, ENGINE_DATA_DIR: dir.path, ENGINE_DISK_STOP_PERCENT: "100",
      ENGINE_ARJUM_BASE_URL: ARJUM_TEST_ORIGIN, ENGINE_ARJUM_API_KEY: ARJUM_TEST_KEY, ...env,
    });
    const engine = await createEngine(config, { fetch: world.fetch, log: nullLogger, now: () => now, limiters: new LimiterRegistry(fakeClock(0)) });
    cleanups.push(async () => { await engine.shutdown(); await dir.cleanup(); });
    const run = async (id: string, expected = "started") => {
      const outcome = await engine.scheduler.trigger(id);
      expect(outcome.status, id).toBe(expected);
      await engine.scheduler.waitFor(id);
      return engine.scheduler.status().find((job) => job.id === id)!;
    };
    const recent = async (query = "") => {
      const response = await engine.app(new Request(`http://engine.test/v1/insiders/recent${query}`));
      expect(response.status).toBe(200);
      return idxBeiEnvelope(insidersRecentSchema).parse(await response.json());
    };
    const insiderCalls = () => world.hits.filter((hit) => hit.source === "arjum" && hit.path.startsWith("/api/insiders/"));
    const called = () => insiderCalls().map((hit) => hit.path.split("?")[0].split("/").pop());
    return { engine, db: engine.services.db, run, recent, insiderCalls, called, setNow: (at: Date) => { now = at; } };
  }

  it("with the default budget (0) the job is not registered and the feed is the UNAVAILABLE empty form", async () => {
    const h = await harness();
    expect(h.engine.scheduler.status().map((job) => job.id)).not.toContain("insider-feed");
    expect(h.engine.registry.jobs.map((job) => job.id)).toContain("foreign-flow");
    await h.run("universe");
    const body = await h.recent();
    expect(body.meta).toMatchObject({ freshness: "UNAVAILABLE", dataAsOf: null });
    expect(body.data).toMatchObject({ days: 7, transactions: [], coverage: { checked: 0, active: 8, revisitDays: 7, oldestCheck: null } });
    expect(h.insiderCalls()).toEqual([]);
  });

  it("rotates through the universe most liquid first within the daily budget, dedupes re-reads and states its coverage", async () => {
    const h = await harness(FEED);
    expect(h.engine.scheduler.status().find((job) => job.id === "insider-feed")).toMatchObject({
      sourceId: "arjum", background: true, trigger: { kind: "window", everyMinutes: 10, from: "21:30", to: "23:30" },
    });
    await h.run("universe");
    h.setNow(wib("2026-10-16", "21:30"));
    expect((await h.run("insider-feed")).lastStatus).toBe("SUCCEEDED");
    const calls = h.insiderCalls();
    expect(calls.map((hit) => hit.path)).toEqual(["/api/insiders/BBCA?page=1&limit=15", "/api/insiders/BBRI?page=1&limit=15", "/api/insiders/BMRI?page=1&limit=15"]);
    expect(calls.every((hit) => hit.apiKey === ARJUM_TEST_KEY && hit.userAgent === ENGINE_USER_AGENT)).toBe(true);

    // Five rows on the page, one an exact repeat: four per symbol, with provenance and the parsed numbers.
    const stored = await h.db.select().from(t.insiderTransactions).orderBy(asc(t.insiderTransactions.symbol), asc(t.insiderTransactions.date));
    expect(stored).toHaveLength(12);
    const sell = stored.find((row) => row.symbol === "BBCA" && row.action === "SELL")!;
    expect(sell).toMatchObject({ person: "SITI CONTOH", roles: ["KOMISARIS"], date: "2026-10-14", sharesChange: -200000, sharesBefore: 2000000, sharesAfter: 1800000, percentAfter: 0.0015, price: 6100, broker: "YP", nationality: "foreign", source: "arjum" });
    expect(sell.rawRef).not.toBeNull();
    expect(stored.find((row) => row.symbol === "BBCA" && row.action === "CROSS")).toMatchObject({ price: null, sharesChange: -37944000, percentAfter: 17.6 });
    const docs = await h.db.select().from(t.rawDocuments).where(eq(t.rawDocuments.source, "arjum"));
    expect(JSON.stringify(docs)).not.toContain(ARJUM_TEST_KEY);

    // The feed: the window's transactions newest first (largest value first within a day), and how much of the market it covers.
    const body = await h.recent("?days=7");
    expect(body.meta.freshness).toBe("HISTORICAL");
    expect(body.meta.dataAsOf).not.toBeNull();
    expect(body.data.coverage).toEqual({ checked: 3, active: 8, revisitDays: 7, oldestCheck: "2026-10-16" });
    expect(body.data.transactions.map((row) => [row.date, row.action])).toEqual([
      ...Array(3).fill(["2026-10-15", "BUY"]), ...Array(3).fill(["2026-10-14", "SELL"]), ...Array(3).fill(["2026-10-13", "CROSS"]),
    ]);
    expect(body.data.transactions[0]).toMatchObject({ person: "BUDI CONTOH", sharesChange: 500000, price: 6000, value: 3_000_000_000, roles: ["DIREKTUR"] });
    const buys = await h.recent("?days=7&action=buy&limit=2");
    expect(buys.data.transactions.map((row) => row.action)).toEqual(["BUY", "BUY"]);

    // The budget is per WIB day: the 21:40 run makes no call; the next day continues where the rotation stopped.
    world.hits.length = 0;
    h.setNow(wib("2026-10-16", "21:40"));
    await h.run("insider-feed");
    expect(h.insiderCalls()).toEqual([]);
    h.setNow(wib("2026-10-17", "21:30"));
    await h.run("insider-feed");
    expect(h.called()).toEqual(["TLKM", "GOTO", "AADI"]);
    // The last two; ABBA is unknown to arjum (404): recorded as read, so the rotation does not retry it daily.
    world.hits.length = 0;
    h.setNow(wib("2026-10-18", "21:30"));
    expect((await h.run("insider-feed")).lastStatus).toBe("SUCCEEDED");
    expect(h.called()).toEqual(["AALI", "ABBA"]);
    expect((await h.recent()).data.coverage).toEqual({ checked: 8, active: 8, revisitDays: 7, oldestCheck: "2026-10-16" });
    const [abba] = await h.db.select().from(t.insiderChecks).where(eq(t.insiderChecks.symbol, "ABBA"));
    expect(abba).toMatchObject({ checkedDate: "2026-10-18", rows: 0, total: null, rawRef: null });

    // Everything was read within 7 days: nothing is due, so no call.
    world.hits.length = 0;
    h.setNow(wib("2026-10-19", "21:30"));
    await h.run("insider-feed");
    expect(h.insiderCalls()).toEqual([]);

    // A week later the first symbols are due again, oldest read first. The same page adds nothing; a new filing adds one row.
    h.setNow(wib("2026-10-23", "21:30"));
    world.state.insidersUpdate = true;
    await h.run("insider-feed");
    expect(h.called()).toEqual(["BBCA", "BBRI", "BMRI"]);
    // Seven symbols with a page (ABBA had none) × four transactions, plus the new filing on the three re-read pages.
    expect(await h.db.$count(t.insiderTransactions)).toBe(7 * 4 + 3);
    expect(await h.db.$count(t.insiderTransactions, eq(t.insiderTransactions.person, "BARU CONTOH"))).toBe(3);
    const later = await h.recent("?days=7");
    // TLKM…ABBA were read on 17–18 Oct, BBCA–BMRI today: all within the 7-day window again.
    expect(later.data.coverage).toEqual({ checked: 8, active: 8, revisitDays: 7, oldestCheck: "2026-10-17" });
    expect(later.data.transactions[0]).toMatchObject({ person: "BARU CONTOH", date: "2026-10-22" });
  });

  it("stops at the reserve and makes no further call that day; resumes the next day", async () => {
    const h = await harness({ ...FEED, ENGINE_ARJUM_INSIDER_BUDGET: "50", ENGINE_ARJUM_DAILY_BUDGET: "100" });
    await h.run("universe");
    h.setNow(wib("2026-10-16", "21:30"));
    world.state.arjumRemaining = 402; // after the first call 401 (above), after the second 400 (= reserve: the next would dip into it)
    await h.run("insider-feed");
    expect(h.called()).toEqual(["BBCA", "BBRI"]);
    const [cursor] = await h.db.select().from(t.jobCursors).where(eq(t.jobCursors.jobId, "insider-feed"));
    expect(cursor.cursor).toMatchObject({ day: "2026-10-16", used: 2, remaining: 400, lastSymbol: "BBRI" });

    // The provider would answer again (the app may not have used its share), but the reserve is not probed again today.
    world.hits.length = 0;
    world.state.arjumRemaining = 1000;
    h.setNow(wib("2026-10-16", "21:40"));
    await h.run("insider-feed");
    expect(h.insiderCalls()).toEqual([]);
    h.setNow(wib("2026-10-17", "21:30"));
    await h.run("insider-feed");
    expect(h.called()).toEqual(["BMRI", "TLKM", "GOTO", "AADI", "AALI", "ABBA"]);
  });

  it("a 429 blocks arjum after one request and is never retried", async () => {
    const h = await harness(FEED);
    await h.run("universe");
    h.setNow(wib("2026-10-16", "21:30"));
    world.state.blocked.add("arjum");
    expect((await h.run("insider-feed")).lastStatus).toBe("BLOCKED");
    expect(h.insiderCalls()).toHaveLength(1);
    const [arjum] = await h.db.select().from(t.sources).where(eq(t.sources.id, "arjum"));
    expect(arjum).toMatchObject({ status: "BLOCKED", blockEvidence: { reason: "RATE_LIMITED", status: 429 } });
    await h.run("insider-feed", "blocked");
    // Foreign flow shares the source, so it stops too.
    await h.run("foreign-flow", "blocked");
    expect(h.insiderCalls()).toHaveLength(1);
  });

  it("refuses a budget split that cannot fit above the reserve", () => {
    const env = { ENGINE_DATABASE_URL: "postgresql://x", ENGINE_ARJUM_BASE_URL: ARJUM_TEST_ORIGIN, ENGINE_ARJUM_API_KEY: ARJUM_TEST_KEY };
    expect(() => loadConfig({ ...env, ENGINE_ARJUM_INSIDER_BUDGET: "100" })).toThrow(/must not exceed/);
    expect(loadConfig({ ...env, ENGINE_ARJUM_INSIDER_BUDGET: "100", ENGINE_ARJUM_DAILY_BUDGET: "500" }).arjum?.insiderBudget).toBe(100);
  });
});
