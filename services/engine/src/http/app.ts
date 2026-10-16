// HTTP surface: liveness/readiness, /v1/meta/health, admin endpoints and the idx-bei /v1 contract.
// A plain (Request) => Response handler, served by Bun.serve in main.ts and called directly in tests.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  actionsSchema, announcementItemSchema, fundamentalsSchema, marketOverviewSchema, newsItemSchema, screenRequestSchema,
  screenResultSchema, securitySchema,
} from "@/server/schemas/idx-bei";
import { symbolSchema } from "@/server/schemas/inputs";
import type { SourceHealth } from "../db/repos";
import type { PauseGuard } from "../schedule/pause";
import type { Scheduler } from "../schedule/scheduler";
import type { Logger } from "../log";
import { nullLogger } from "../log";
import { envelope, unavailableMeta } from "./envelope";

export type AppDeps = {
  apiToken?: string;
  adminToken?: string;
  ping(): Promise<boolean>;
  pause: PauseGuard;
  scheduler: Scheduler;
  sourceHealth(): Promise<SourceHealth[]>;
  unblockSource(id: string): Promise<boolean>;
  rawStoreKind: "s3" | "local";
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
      const [sources, pause] = await Promise.all([deps.sourceHealth(), deps.pause.check()]);
      // Operational status, not market data: meta.freshness stays UNAVAILABLE.
      return json({
        data: { sources, scheduler: { paused: pause.paused, pauseReason: pause.reason, diskPercent: pause.diskPercent, diskStopPercent: pause.diskStopPercent, jobs: deps.scheduler.status() }, rawStore: deps.rawStoreKind },
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

    if (path === "/v1/market") return json(envelope(marketOverviewSchema, { indices: [], breadth: { advancers: 0, decliners: 0, unchanged: 0, value: 0, volume: 0, frequency: 0 }, movers: [] }, unavailableMeta(at)));
    if (path === "/v1/securities") return json(envelope(securitySchema.array(), [], unavailableMeta(at)));
    if (path === "/v1/news") return json(envelope(newsItemSchema.array(), [], unavailableMeta(at)));
    if (path === "/v1/announcements") return json(envelope(announcementItemSchema.array(), [], unavailableMeta(at)));
    // No trading date can be vouched for yet; the schema has no empty form, so this is a typed miss.
    if (path === "/v1/signals") return error(404, "NO_DATA", "No signals available yet");

    const stock = path.match(/^\/v1\/stocks\/([^/]+)(?:\/(fundamentals|actions|profile))?$/);
    if (stock) {
      const symbol = symbolSchema.safeParse(decodeURIComponent(stock[1]));
      if (!symbol.success) return error(400, "BAD_REQUEST", "Invalid symbol");
      if (stock[2] === "fundamentals") return json(envelope(fundamentalsSchema, [], unavailableMeta(at)));
      if (stock[2] === "actions") return json(envelope(actionsSchema, [], unavailableMeta(at)));
      // quote and profile have no empty form in the contract: a symbol without data is a 404, never a fake row.
      return error(404, "NO_DATA", `No ${stock[2] ?? "price"} data for ${symbol.data}`);
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

