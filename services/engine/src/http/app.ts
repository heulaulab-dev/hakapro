// HTTP surface: liveness/readiness, /v1/meta/health, admin endpoints and the idx-bei /v1 contract.
// A plain (Request) => Response handler, served by Bun.serve in main.ts and called directly in tests.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  actionsSchema, announcementItemSchema, fundamentalsSchema, marketOverviewSchema, newsItemSchema, screenRequestSchema,
  screenResultSchema, securitySchema, signalsSchema, stockSchema,
} from "@/server/schemas/idx-bei";
import { symbolSchema } from "@/server/schemas/inputs";
import type { SourceHealth } from "../db/repos";
import type { PauseGuard } from "../schedule/pause";
import type { Scheduler } from "../schedule/scheduler";
import type { Logger } from "../log";
import { nullLogger } from "../log";
import { DEFAULT_CANDLES, MAX_CANDLES, serveActions, serveMarket, serveSecurities, serveSignals, serveStock, type Served } from "../serve/market";
import type { MarketStore } from "../serve/store";
import { envelope, servedMeta, unavailableMeta } from "./envelope";

export type EodSessionHealth = { date: string; status: string; expected: number; present: number; attempts: number; finalizedAt: string | null };

export type AppDeps = {
  apiToken?: string;
  adminToken?: string;
  ping(): Promise<boolean>;
  pause: PauseGuard;
  scheduler: Scheduler;
  sourceHealth(): Promise<SourceHealth[]>;
  unblockSource(id: string): Promise<boolean>;
  rawStoreKind: "s3" | "local";
  /** Stored market data (E2/E2b). Without it the idx-bei routes answer as the E1 stubs did. */
  market?: MarketStore;
  /** Recent EOD session completeness for /v1/meta/health. */
  eodSessions?: () => Promise<EodSessionHealth[]>;
  now?: () => Date;
  log?: Logger;
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const error = (status: number, code: string, message: string, headers?: Record<string, string>) => json({ error: { code, message } }, status, headers);

function tokenMatches(header: string | null, expected: string): boolean {
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const given = Buffer.from(match[1].trim());
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
}

const jobIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

export function createApp(deps: AppDeps): (request: Request) => Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? nullLogger;

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const method = request.method.toUpperCase();
    const get = method === "GET" || method === "HEAD";

    if (path === "/health") return get ? json({ status: "ok" }) : error(405, "METHOD_NOT_ALLOWED", "Use GET");
    if (path === "/ready") {
      if (!get) return error(405, "METHOD_NOT_ALLOWED", "Use GET");
      const [database, pause] = await Promise.all([deps.ping(), deps.pause.check()]);
      const diskOk = pause.diskPercent !== null && pause.diskPercent <= pause.diskStopPercent;
      const ready = database && diskOk;
      return json({ status: ready ? "ready" : "not_ready", checks: { database, disk: { ok: diskOk, percent: pause.diskPercent, stopPercent: pause.diskStopPercent } } }, ready ? 200 : 503);
    }
    if (!path.startsWith("/v1/") && path !== "/v1") return error(404, "NOT_FOUND", "Not found");

    // Admin: ENGINE_ADMIN_TOKEN only; disabled entirely when it is unset.
    if (path.startsWith("/v1/admin/")) {
      if (!deps.adminToken) return error(404, "NOT_FOUND", "Not found");
      if (!tokenMatches(request.headers.get("authorization"), deps.adminToken)) return error(401, "UNAUTHORIZED", "Admin token required", { "www-authenticate": "Bearer" });
      if (method !== "POST") return error(405, "METHOD_NOT_ALLOWED", "Use POST");
      return admin(path);
    }

    if (deps.apiToken && !tokenMatches(request.headers.get("authorization"), deps.apiToken)) {
      return error(401, "UNAUTHORIZED", "API token required", { "www-authenticate": "Bearer" });
    }
    const at = now();

    if (path === "/v1/meta/health") {
      if (!get) return error(405, "METHOD_NOT_ALLOWED", "Use GET");
      const [sources, pause, eodSessions] = await Promise.all([deps.sourceHealth(), deps.pause.check(), deps.eodSessions?.() ?? Promise.resolve([])]);
      // Operational status, not market data: meta.freshness stays UNAVAILABLE.
      return json({
        data: { sources, scheduler: { paused: pause.paused, pauseReason: pause.reason, diskPercent: pause.diskPercent, diskStopPercent: pause.diskStopPercent, jobs: deps.scheduler.status() }, rawStore: deps.rawStoreKind, eodSessions },
        meta: unavailableMeta(at),
      });
    }

    // idx-bei contract stubs (E1): valid envelopes with empty data until E2/E3 sources land.
    if (path === "/v1/screener") {
      if (method !== "POST") return error(405, "METHOD_NOT_ALLOWED", "Use POST");
      const parsed = screenRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return error(400, "BAD_REQUEST", "Invalid screener request");
      return json(envelope(screenResultSchema, { rows: [], total: 0, supportedFields: [] }, unavailableMeta(at)));
    }
    if (!get) return error(405, "METHOD_NOT_ALLOWED", "Use GET");

    const market = deps.market;
    // Stored data when there is some; otherwise the contract's empty form (or a typed 404 where it has none).
    const respond = <T extends z.ZodType>(schema: T, served: Served<z.input<T>> | null, empty: z.input<T>) =>
      json(served ? envelope(schema, served.data, servedMeta(served, at)) : envelope(schema, empty, unavailableMeta(at)));

    if (path === "/v1/market") {
      return respond(marketOverviewSchema, market ? await serveMarket(market, at) : null, { indices: [], breadth: { advancers: 0, decliners: 0, unchanged: 0, value: 0, volume: 0, frequency: 0 }, movers: [] });
    }
    if (path === "/v1/securities") {
      return respond(securitySchema.array(), market ? await serveSecurities(market, (url.searchParams.get("q") ?? "").slice(0, 64), at) : null, []);
    }
    if (path === "/v1/news") return json(envelope(newsItemSchema.array(), [], unavailableMeta(at)));
    if (path === "/v1/announcements") return json(envelope(announcementItemSchema.array(), [], unavailableMeta(at)));
    if (path === "/v1/signals") {
      const served = market ? await serveSignals(market, at) : null;
      // No trading date can be vouched for without foreign data; the schema has no empty form, so this is a typed miss.
      if (!served) return error(404, "NO_DATA", "No signals available yet");
      return json(envelope(signalsSchema, served.data, servedMeta(served, at)));
    }

    const stock = path.match(/^\/v1\/stocks\/([^/]+)(?:\/(fundamentals|actions|profile))?$/);
    if (stock) {
      const symbol = symbolSchema.safeParse(decodeURIComponent(stock[1]));
      if (!symbol.success) return error(400, "BAD_REQUEST", "Invalid symbol");
      if (stock[2] === "fundamentals") return json(envelope(fundamentalsSchema, [], unavailableMeta(at)));
      if (stock[2] === "actions") return respond(actionsSchema, market ? await serveActions(market, symbol.data, at) : null, []);
      if (stock[2] === "profile") return error(404, "NO_DATA", `No profile data for ${symbol.data}`);
      const limit = Number(url.searchParams.get("limit") ?? DEFAULT_CANDLES);
      if (!Number.isInteger(limit) || limit < 1) return error(400, "BAD_REQUEST", "Invalid limit");
      const served = market ? await serveStock(market, symbol.data, Math.min(limit, MAX_CANDLES), at) : null;
      // A quote has no empty form in the contract: a symbol without data is a 404, never a fake row.
      if (!served) return error(404, "NO_DATA", `No price data for ${symbol.data}`);
      return json(envelope(stockSchema, served.data, servedMeta(served, at)));
    }
    return error(404, "NOT_FOUND", "Not found");
  }

  async function admin(path: string): Promise<Response> {
    if (path === "/v1/admin/pause" || path === "/v1/admin/resume") {
      const state = await deps.pause.setFlag(path.endsWith("pause"), "admin");
      log.warn("scheduler_pause_flag", { paused: path.endsWith("pause") });
      return json({ data: state });
    }
    const job = path.match(/^\/v1\/admin\/jobs\/([^/]+)\/run$/);
    if (job) {
      const id = jobIdSchema.safeParse(decodeURIComponent(job[1]));
      if (!id.success) return error(400, "BAD_REQUEST", "Invalid job id");
      const outcome = await deps.scheduler.trigger(id.data);
      const status = outcome.status === "started" ? 202 : outcome.status === "unknown_job" ? 404 : 409;
      return json({ data: outcome }, status);
    }
    const unblock = path.match(/^\/v1\/admin\/sources\/([^/]+)\/unblock$/);
    if (unblock) {
      const id = jobIdSchema.safeParse(decodeURIComponent(unblock[1]));
      if (!id.success) return error(400, "BAD_REQUEST", "Invalid source id");
      const changed = await deps.unblockSource(id.data);
      log.warn("source_unblocked", { source: id.data, changed });
      return json({ data: { source: id.data, unblocked: changed } }, changed ? 200 : 409);
    }
    return error(404, "NOT_FOUND", "Not found");
  }

  return async (request) => {
    try {
      return await handle(request);
    } catch (caught) {
      log.error("request_failed", { message: caught instanceof Error ? caught.message : String(caught) });
      return error(500, "INTERNAL", "Internal error");
    }
  };
}

