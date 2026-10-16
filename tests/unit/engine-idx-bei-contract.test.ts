// The Data Engine's /v1 stubs must be consumable by the app's IdxBeiSource (MARKET_API_URL) without crashing.
// Lives here, not in services/engine, because it typechecks app code (Next/DOM fetch types).
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarketDataError } from "@/server/market/errors";
import { IdxBeiSource } from "@/server/market/idx-bei-source";
import { MemoryCursorStore, MemoryRunRecorder, MemorySourceStateStore } from "../../services/engine/src/fetch/stores";
import { createApp } from "../../services/engine/src/http/app";
import { PauseGuard } from "../../services/engine/src/schedule/pause";
import { Scheduler } from "../../services/engine/src/schedule/scheduler";

const BASE = "http://engine.test";
const NOW = new Date("2026-10-14T10:00:00Z");

describe("engine /v1 stubs via IdxBeiSource", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "engine-contract-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("parses every stub and labels it UNAVAILABLE", async () => {
    const pause = new PauseGuard(dir, 85, { cacheMs: 0, measure: async () => 10 });
    const sourceState = new MemorySourceStateStore();
    const scheduler = new Scheduler({ jobs: [], pause, runs: new MemoryRunRecorder(), cursors: new MemoryCursorStore(), sourceState });
    const app = createApp({ ping: async () => true, pause, scheduler, rawStoreKind: "local", sourceHealth: async () => [], unblockSource: async () => false, now: () => NOW });
    const fetcher = ((input: string | URL | Request, init?: RequestInit) => app(new Request(input, init))) as typeof fetch;
    const source = new IdxBeiSource(BASE, () => NOW, fetcher);

    const market = await source.marketOverview();
    expect(market.freshness).toBe("UNAVAILABLE");
    expect(market.data.indices).toEqual([]);
    expect((await source.securities("")).data).toEqual([]);
    expect((await source.news({})).data).toEqual([]);
    expect((await source.announcements({ keywords: "dividen" })).data).toEqual([]);
    expect((await source.fundamentals("BBCA")).data).toEqual([]);
    expect((await source.corporateActions("BBCA")).data).toEqual([]);
    expect((await source.screen({ conditions: [], limit: 10 })).data.rows).toEqual([]);
    // No price data yet: a typed provider error, never a fake quote.
    await expect(source.stock("BBCA")).rejects.toBeInstanceOf(MarketDataError);
  });
});
