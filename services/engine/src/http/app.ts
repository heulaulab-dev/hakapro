// HTTP surface: liveness/readiness, /v1/meta/health, admin endpoints and the idx-bei /v1 contract.
// A plain (Request) => Response handler, served by Bun.serve in main.ts and called directly in tests.
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  actionsCalendarSchema, actionsSchema, announcementItemSchema, fundamentalsSchema, macroSchema, marketOverviewSchema, newsItemSchema, sectorsSchema,
  screenRequestSchema, screenResultSchema, securitySchema, signalsSchema, stockSchema,
} from "@/server/schemas/idx-bei";
import { dateSchema, symbolSchema } from "@/server/schemas/inputs";
import { ownershipChangesSchema, ownershipMonthSchema, stockOwnershipSchema } from "@/server/schemas/ownership";
import { strategyBoardSchema } from "@/lib/strategies/contract";
import type { SourceHealth } from "../db/repos";
import type { PauseGuard } from "../schedule/pause";
import type { JobStatus, Scheduler } from "../schedule/scheduler";
import type { Logger } from "../log";
import { nullLogger } from "../log";
import { DEFAULT_CANDLES, MAX_CANDLES, serveActions, serveMarket, serveSectors, serveSecurities, serveSignals, serveStock, type Served } from "../serve/market";
import {
  ACTIONS_MAX_RANGE_DAYS, defaultActionsRange, NEWS_DEFAULT_PAGE_SIZE, NEWS_MAX_PAGE, NEWS_MAX_PAGE_SIZE, serveActionsCalendar, serveMacro, serveNews,
} from "../serve/market-info";
import { serveFundamentals, serveScreener } from "../serve/fundamentals";
import { previousMonth as previousMonthOf } from "../ownership/numbers";
import { emptyStockOwnership, serveOwnershipChanges, serveStockOwnership } from "../serve/ownership";
import type { MarketStore } from "../serve/store";
import { EMPTY_BOARD, serveStrategies, strategyScanHealth, type StrategyStore } from "../serve/strategies";
import { STRATEGY_RULES, type StrategyRules } from "../strategies/rules";
import { envelope, servedMeta, unavailableMeta } from "./envelope";
import { ownershipAdmin, type OwnershipDeps } from "./ownership-admin";

export type EodSessionHealth = { date: string; status: string; expected: number; present: number; attempts: number; finalizedAt: string | null };

export type AppDeps = {
  apiToken?: string;
  adminToken?: string;
  ping(): Promise<boolean>;
  pause: PauseGuard;
  scheduler: Scheduler;
  sourceHealth(): Promise<SourceHealth[]>;
  /** Latest completed jobs from persistence, available before this process runs any scheduled work. */
  jobHistory?(): Promise<Array<Pick<JobStatus, "id" | "lastStartedAt" | "lastStatus" | "lastError">>>;
  unblockSource(id: string): Promise<boolean>;
  rawStoreKind: "s3" | "local";
  /** Stored market data (E2/E2b). Without it the idx-bei routes answer as the E1 stubs did. */
  market?: MarketStore;
  /** Recent EOD session completeness for /v1/meta/health. */
  eodSessions?: () => Promise<EodSessionHealth[]>;
  /** Ownership uploads and their snapshot sets (E6). Without it the ownership routes answer with empty forms. */
  ownership?: OwnershipDeps;
  /** E4 strategy scans (ENGINE_STRATEGY_SCANS_ENABLED). Absent or disabled → /v1/strategies serves the empty board. */
  strategies?: { enabled: boolean; store: StrategyStore | null; rules?: StrategyRules };
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

/** Contract routes answered with an empty `UNAVAILABLE` form (or a typed 404), and why; listed on /v1/meta/health. */
export const UNAVAILABLE_ROUTES = [
  {
    route: "/v1/announcements", status: "SOURCE_BLOCKED",
    reason: "IDX disclosures (keterbukaan informasi) are published only on www.idx.co.id, which answers the engine's user agent with a Cloudflare HTTP 403 (DATA-ENGINE.md §5.0, §5.4). No fetcher is configured, and none will be until an IDX allowlist or data licence exists (§8.5).",
  },
  { route: "/v1/stocks/{s}/profile", status: "SOURCE_BLOCKED", reason: "Company profiles come from IDX (blocked, §5.0); answered with 404 NO_DATA." },
] as const;

/** Listed under `unavailable` while ENGINE_STRATEGY_SCANS_ENABLED is off (the default). */
export const STRATEGIES_DISABLED = {
  route: "/v1/strategies", status: "DISABLED",
  reason: "ENGINE_STRATEGY_SCANS_ENABLED is off (the default): the HAKA-17 strategy rules are a draft (v0.1) awaiting owner approval, so no scan runs and the route answers with the empty UNAVAILABLE board. See strategyScans.",
} as const;

const pageParam = (max: number, fallback: number) => z.string().regex(/^\d{1,6}$/).transform(Number).pipe(z.number().int().min(1).max(max)).optional().transform((value) => value ?? fallback);
const newsQuerySchema = z.object({ page: pageParam(NEWS_MAX_PAGE, 1), page_size: pageParam(NEWS_MAX_PAGE_SIZE, NEWS_DEFAULT_PAGE_SIZE), symbol: symbolSchema.optional() });
const DAY_MS = 86_400_000;
/** A calendar date that exists (2026-02-31 does not). */
const realDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** A query parameter, with an empty value treated as absent. */
const param = (url: URL, name: string) => url.searchParams.get(name) || undefined;

export function createApp(deps: AppDeps): (request: Request) => Promise<Response> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? nullLogger;
  const scansEnabled = deps.strategies?.enabled === true;
  const rules = deps.strategies?.rules ?? STRATEGY_RULES;

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
      if (path.startsWith("/v1/admin/ownership/")) {
        if (!deps.ownership) return error(404, "NOT_FOUND", "Ownership uploads are not configured");
        return ownershipAdmin(deps.ownership, request, url, path, method, { pause: deps.pause, now: now(), log });
      }
      if (method !== "POST") return error(405, "METHOD_NOT_ALLOWED", "Use POST");
      return admin(path);
    }

    if (deps.apiToken && !tokenMatches(request.headers.get("authorization"), deps.apiToken)) {
      return error(401, "UNAUTHORIZED", "API token required", { "www-authenticate": "Bearer" });
    }
    const at = now();

    if (path === "/v1/meta/health") {
      if (!get) return error(405, "METHOD_NOT_ALLOWED", "Use GET");
      const [sources, pause, eodSessions, strategyScans, jobHistory] = await Promise.all([
        deps.sourceHealth(), deps.pause.check(), deps.eodSessions?.() ?? Promise.resolve([]),
        strategyScanHealth(scansEnabled, deps.strategies?.store ?? null, rules),
        deps.jobHistory?.() ?? Promise.resolve([]),
      ]);
      const historyById = new Map(jobHistory.map((run) => [run.id, run]));
      const jobs = deps.scheduler.status().map((job) => {
        const previous = historyById.get(job.id);
        if (!previous) return job;
        return {
          ...job,
          lastStartedAt: job.lastStartedAt ?? previous.lastStartedAt,
          lastStatus: job.lastStatus ?? previous.lastStatus,
          lastError: job.lastStatus === null ? previous.lastError : job.lastError,
        };
      });
      // Operational status, not market data: meta.freshness stays UNAVAILABLE.
      return json({
        data: {
          sources, scheduler: { paused: pause.paused, pauseReason: pause.reason, diskPercent: pause.diskPercent, diskStopPercent: pause.diskStopPercent, jobs },
          rawStore: deps.rawStoreKind, eodSessions, unavailable: [...UNAVAILABLE_ROUTES, ...(scansEnabled ? [] : [STRATEGIES_DISABLED])], strategyScans,
        },
        meta: unavailableMeta(at),
      });
    }

    // The screener over the newest session (E5); the contract's empty form until a session is stored.
    if (path === "/v1/screener") {
      if (method !== "POST") return error(405, "METHOD_NOT_ALLOWED", "Use POST");
      const parsed = screenRequestSchema.safeParse(await request.json().catch(() => undefined));
      if (!parsed.success) return error(400, "BAD_REQUEST", "Invalid screener request");
      const served = deps.market ? await serveScreener(deps.market, parsed.data, at) : null;
      if (!served) return json(envelope(screenResultSchema, { rows: [], total: 0, supportedFields: [] }, unavailableMeta(at)));
      return json(envelope(screenResultSchema, served.data, servedMeta(served, at)));
    }
    if (!get) return error(405, "METHOD_NOT_ALLOWED", "Use GET");

    const market = deps.market;
    // Stored data when there is some; otherwise the contract's empty form (or a typed 404 where it has none).
    const respond = <T extends z.ZodType>(schema: T, served: Served<z.input<T>> | null, empty: z.input<T>) =>
      json(served ? envelope(schema, served.data, servedMeta(served, at)) : envelope(schema, empty, unavailableMeta(at)));

    if (path === "/v1/market") {
      return respond(marketOverviewSchema, market ? await serveMarket(market, at) : null, { indices: [], breadth: { advancers: 0, decliners: 0, unchanged: 0, value: 0, volume: 0, frequency: 0 }, movers: [] });
    }
    if (path === "/v1/sectors") return respond(sectorsSchema, market ? await serveSectors(market, at) : null, []);
    if (path === "/v1/securities") {
      return respond(securitySchema.array(), market ? await serveSecurities(market, (url.searchParams.get("q") ?? "").slice(0, 64), at) : null, []);
    }
    if (path === "/v1/news") {
      const query = newsQuerySchema.safeParse({ page: param(url, "page"), page_size: param(url, "page_size"), symbol: param(url, "symbol") });
      if (!query.success) return error(400, "BAD_REQUEST", "Invalid page, page_size or symbol");
      const { page, page_size: pageSize, symbol } = query.data;
      return respond(newsItemSchema.array(), market ? await serveNews(market, { page, pageSize, symbol }, at) : null, []);
    }
    // Blocked at the source (see UNAVAILABLE_ROUTES): always the contract's empty form, whatever the query.
    if (path === "/v1/announcements") return json(envelope(announcementItemSchema.array(), [], unavailableMeta(at)));
    if (path === "/v1/macro") {
      const served = market ? await serveMacro(market, at) : null;
      return respond(macroSchema, served, { series: [] });
    }
    if (path === "/v1/actions") {
      const fallback = defaultActionsRange(at);
      const from = dateSchema.safeParse(param(url, "from") ?? fallback.from);
      const to = dateSchema.safeParse(param(url, "to") ?? fallback.to);
      if (!from.success || !to.success || !realDate(from.data) || !realDate(to.data)) return error(400, "BAD_REQUEST", "from and to must be YYYY-MM-DD dates");
      const span = (Date.parse(to.data) - Date.parse(from.data)) / DAY_MS;
      if (span < 0 || span > ACTIONS_MAX_RANGE_DAYS) return error(400, "BAD_REQUEST", `from must not be after to, and the range is at most ${ACTIONS_MAX_RANGE_DAYS} days`);
      return respond(actionsCalendarSchema, market ? await serveActionsCalendar(market, { from: from.data, to: to.data }, at) : null, []);
    }
    if (path === "/v1/strategies") {
      // HAKA-18 board of the latest scan. Disabled (default) or no run yet: the contract's empty form, UNAVAILABLE.
      const store = scansEnabled ? deps.strategies?.store : null;
      return respond(strategyBoardSchema, store ? await serveStrategies(store, rules, at) : null, EMPTY_BOARD);
    }
    if (path === "/v1/signals") {
      const served = market ? await serveSignals(market, at) : null;
      // No trading date can be vouched for without foreign data; the schema has no empty form, so this is a typed miss.
      if (!served) return error(404, "NO_DATA", "No signals available yet");
      return json(envelope(signalsSchema, served.data, servedMeta(served, at)));
    }

    if (path === "/v1/ownership/changes") {
      // Without month: the newest stored month (the market-wide feed), or this month's empty form before any upload.
      const store = deps.ownership?.service.store;
      const requested = param(url, "month") ?? (await store?.latestMonth()) ?? at.toISOString().slice(0, 7);
      const month = ownershipMonthSchema.safeParse(requested);
      const symbol = symbolSchema.optional().safeParse(param(url, "symbol"));
      if (!month.success || !symbol.success) return error(400, "BAD_REQUEST", "month must be YYYY-MM; symbol is optional");
      const served = store ? await serveOwnershipChanges(store, month.data, symbol.data) : null;
      return respond(ownershipChangesSchema, served, { month: month.data, previousMonth: previousMonthOf(month.data), comparisons: [], changes: [] });
    }

    const stock = path.match(/^\/v1\/stocks\/([^/]+)(?:\/(fundamentals|actions|profile|ownership))?$/);
    if (stock) {
      const symbol = symbolSchema.safeParse(decodeURIComponent(stock[1]));
      if (!symbol.success) return error(400, "BAD_REQUEST", "Invalid symbol");
      if (stock[2] === "ownership") {
        const served = deps.ownership ? await serveStockOwnership(deps.ownership.service.store, symbol.data, { freeFloatEnabled: deps.ownership.freeFloatEnabled }) : null;
        return respond(stockOwnershipSchema, served, emptyStockOwnership(symbol.data));
      }
      if (stock[2] === "fundamentals") return respond(fundamentalsSchema, market ? await serveFundamentals(market, symbol.data) : null, []);
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

