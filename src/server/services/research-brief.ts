import "server-only";
import { ARJUM_LIMITS } from "@/lib/api/provider-limits";
import { classifySessionDate, jakartaClock, marketPhase, type Freshness, type WithFreshness } from "@/lib/freshness";
import { mergeLastPrice } from "@/lib/last-price";
import { logWarn } from "@/server/log";
import { MarketDataError } from "@/server/market/errors";
import type { MarketDataSource } from "@/server/market/source";
import type { BrokerSummary, History, Insiders, LastPrice, SearchResult, Security } from "@/server/market/types";
import {
  counterEvidence, insiderFacts, momentumFacts, priceChangeSince, sessionWindows, volumeFacts, WINDOWS,
  type CounterEvidence, type SessionWindow, type WindowKey,
} from "./research-evidence";

/**
 * Research Brief (spec §3, rollout phases 1–2): one reproducible page of evidence for a ticker, built only
 * from existing market-data capabilities. No score is computed yet (`score.version` is "none"); a
 * component whose data is missing is marked missing and lowers `confidence`, never counted as zero.
 */

export const COMPONENT_KEYS = ["momentum", "foreign", "broker", "ksei", "insider", "volume"] as const;
export type ComponentKey = (typeof COMPONENT_KEYS)[number];
export type ComponentStatus = "ok" | "stale" | "missing";
export type Raw = Record<string, number | string | null>;

export type BriefComponent = {
  key: ComponentKey;
  /** 0 while no score version is published. */
  weight: number;
  raw: Raw;
  /** Null = no points (no score yet, or missing data), never zero. */
  points: number | null;
  status: ComponentStatus;
  /** Why a component is missing (a reason code the UI localizes); null otherwise. */
  reason: string | null;
  source: { table: string; asOf: string | null };
};

export type InsiderTransaction = { date: string; person: string; action: "BUY" | "SELL" | "CROSS" | "OTHER"; roles: string[]; changeShares: number | null; priceIdr: number | null };
export type QualityCheck = { key: "price_history" | "foreign_sources" | "broker_windows"; result: "match" | "mismatch" | "not_applicable" };
export type BriefSource = { table: string; asOf: string | null; rows: number; range: string | null };

export type ResearchBrief = {
  code: string;
  name: string | null;
  sector: string | null;
  /** Trading date of the price (with the last trade time when the price is today's). */
  asOf: string;
  freshness: "fresh" | "stale" | "missing";
  price: {
    last: number; change: number | null; changePct: number | null; window: "1D"; session: string;
    source: { table: string; asOf: string | null };
    /** Freshness of the envelope the price came from, exactly as the stock page header shows it. */
    meta: { freshness: Freshness; asOf: string | null; source: string };
  };
  score: { value: null; confidence: number; version: "none" };
  windows: WindowKey[];
  components: BriefComponent[];
  insiderTransactions: InsiderTransaction[];
  counterEvidence: CounterEvidence[];
  checks: QualityCheck[];
  sources: BriefSource[];
  quota: { used: number; limit: number | null; charged: boolean };
  /** When this brief was computed (ISO). */
  generatedAt: string;
};

export class UnknownTickerError extends Error {
  constructor(readonly code: string) { super(`Unknown ticker ${code}`); this.name = "UnknownTickerError"; }
}
/** The price itself is unavailable, so no brief can be anchored; lists the components that are missing. */
export class BriefUnavailableError extends Error {
  constructor(readonly missing: string[]) { super("Research brief data unavailable"); this.name = "BriefUnavailableError"; }
}

type Loaded<T> = { ok: true; envelope: WithFreshness<T> } | { ok: false; error: string };

async function load<T>(run: () => Promise<WithFreshness<T>>): Promise<Loaded<T>> {
  try {
    return { ok: true, envelope: await run() };
  } catch (error) {
    return { ok: false, error: error instanceof MarketDataError ? error.code : "INTERNAL_ERROR" };
  }
}

/** Runs tasks with at most `limit` in flight, so one brief never bursts the provider's rate limit. */
async function pooled<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** A dataset is current when its date is today's session in progress or the last completed one. */
function sessionStatus(date: string | null | undefined, now: Date): "ok" | "stale" {
  const freshness = classifySessionDate(date, now);
  return freshness === "LIVE" || freshness === "DELAYED" || freshness === "EOD" ? "ok" : "stale";
}

const table = (envelope: WithFreshness<unknown>, dataset: string) => `${envelope.source}/${dataset}`;

function missing(key: ComponentKey, reason: string, dataset: string): BriefComponent {
  return { key, weight: 0, raw: {}, points: null, status: "missing", reason, source: { table: dataset, asOf: null } };
}

const BROKER_FLOWS = ["foreign", "domestic"] as const;
type BrokerCell = { netValueIdr: number; start: string; end: string } | null;

export type BuildOptions = { days?: number; now?: Date; signal?: AbortSignal };

export async function buildResearchBrief(source: MarketDataSource, code: string, options: BuildOptions = {}): Promise<ResearchBrief> {
  const now = options.now ?? new Date();
  const days = options.days ?? 30;
  const signal = options.signal;

  // Phase 1: identity and the price anchor.
  const [price, history, search, securities] = await Promise.all([
    load<LastPrice>(() => source.price(code, signal)),
    load<History>(() => source.history(code, { frame: "daily", limit: 60 }, signal)),
    load<SearchResult[]>(() => source.search(code, signal)),
    load<Security[]>(() => source.securities(code)),
  ]);
  const rows = history.ok ? history.envelope.data.rows : [];
  const searchMatch = search.ok ? search.envelope.data.find((row) => row.symbol === code) : undefined;
  const security = securities.ok ? securities.envelope.data.find((row) => row.symbol === code) : undefined;
  const confirmed = Boolean(searchMatch || security || rows.length || price.ok);
  // Only a lookup that answered (and found nothing anywhere) proves a ticker unknown; failed lookups prove nothing.
  if (!confirmed && (search.ok || securities.ok || (!price.ok && price.error === "NOT_FOUND"))) throw new UnknownTickerError(code);

  // Same merge as the stock page header (StockHeaderLive) and watchlist quotes: one price per session everywhere.
  const merged = mergeLastPrice(rows, price.ok ? price.envelope.data : null);
  const windows = sessionWindows(rows);
  const latest = rows.at(-1);

  if (!merged) {
    // Without a price there is nothing to anchor the brief to; skip the remaining provider calls.
    for (const loaded of [price, history]) if (!loaded.ok) logWarn("research_brief_price_missing", { code, error: loaded.error });
    throw new BriefUnavailableError(["price", ...(rows.length ? [] : (["momentum", "foreign", "volume"] as const)), "ksei"]);
  }

  // Phase 2: flow and disclosures.
  const brokerWindows: Array<{ key: WindowKey; start?: string; end?: string }> = latest
    ? WINDOWS.filter((key) => windows[key]).map((key) => ({ key, start: windows[key]!.start, end: windows[key]!.end }))
    : [{ key: "1D" }];
  const [insiders, brokerResults] = await Promise.all([
    load<Insiders>(() => source.insiders(code, { limit: ARJUM_LIMITS.insiders }, signal)),
    pooled(brokerWindows.flatMap((window) => BROKER_FLOWS.map((flow) => async () => ({
      window, flow,
      result: await load<BrokerSummary>(() => source.brokerSummary(code, { startDate: window.start, endDate: window.end, flow, brokerLimit: ARJUM_LIMITS.brokerSummaryRows, levelLimit: 1 }, signal)),
    }))), 2),
  ]);

  const components: BriefComponent[] = [];
  const historyError = history.ok ? "INSUFFICIENT_HISTORY" : history.error;

  // momentum
  const momentum = momentumFacts(rows);
  if (history.ok && momentum && windows["1D"]) {
    const raw: Raw = { session: momentum.session, close: momentum.close, sma20: momentum.sma20, closeVsSma20: momentum.closeVsSma20 };
    for (const key of WINDOWS) raw[`change${key}Pct`] = windows[key]?.priceChangePercent ?? null;
    components.push({ key: "momentum", weight: 0, raw, points: null, status: sessionStatus(momentum.session, now), reason: null, source: { table: table(history.envelope, "history"), asOf: history.envelope.asOf } });
  } else components.push(missing("momentum", historyError, "history"));

  // foreign (net foreign shares per window, from daily history)
  const longest = [...WINDOWS].reverse().map((key) => windows[key]).find((window): window is SessionWindow => window !== null);
  if (history.ok && longest && latest) {
    const raw: Raw = { session: latest.date, buySessions: longest.foreignBuySessions, sellSessions: longest.foreignSellSessions, flowSessions: longest.sessions };
    for (const key of WINDOWS) raw[`net${key}`] = windows[key]?.foreignNetShares ?? null;
    components.push({ key: "foreign", weight: 0, raw, points: null, status: sessionStatus(latest.date, now), reason: null, source: { table: table(history.envelope, "history"), asOf: history.envelope.asOf } });
  } else components.push(missing("foreign", historyError, "history"));

  // broker (net value by investor category; only categories the provider actually labels)
  const brokerForeign: Partial<Record<WindowKey, BrokerCell>> = {};
  const brokerRaw: Raw = { localInstitution: null, retail: null };
  let brokerCells = 0, brokerRows = 0, brokerAsOf: string | null = null, brokerTable = "broker_summary", brokerError: string | null = null, windowMismatch = false, brokerOk = 0;
  for (const { window, flow, result } of brokerResults) {
    const key = window.key;
    brokerRaw[`${flow}${key}`] ??= null;
    if (!result.ok) { brokerError ??= result.error; continue; }
    const data = result.envelope.data;
    brokerOk += 1;
    brokerRows += data.brokers.length;
    brokerTable = table(result.envelope, "broker_summary");
    if (window.start && (data.startDate !== window.start || data.endDate !== window.end)) windowMismatch = true;
    // A response not labelled with the requested category is never relabelled as that category.
    if (data.flow !== flow) continue;
    const net = data.brokers.reduce((sum, row) => sum + row.netValueIdr, 0);
    brokerRaw[`${flow}${key}`] = net;
    brokerRaw[`start${key}`] = data.startDate;
    brokerRaw[`end${key}`] = data.endDate;
    if (flow === "foreign") brokerForeign[key] = { netValueIdr: net, start: data.startDate, end: data.endDate };
    brokerCells += 1;
    if (!brokerAsOf || data.endDate > brokerAsOf) brokerAsOf = data.endDate;
  }
  if (brokerCells > 0) components.push({ key: "broker", weight: 0, raw: brokerRaw, points: null, status: sessionStatus(brokerAsOf, now), reason: null, source: { table: brokerTable, asOf: brokerAsOf } });
  else components.push(missing("broker", brokerOk > 0 ? "NO_CATEGORY_BREAKDOWN" : brokerError ?? "NOT_AVAILABLE", brokerTable));

  // ksei (≥1% ownership): no capability provides it yet; the slot stays so it can be filled later.
  components.push(missing("ksei", "NOT_AVAILABLE", "ksei_ownership"));

  // insider (reported transactions within the lookback, relative to the brief's session)
  const anchorDate = merged.date;
  let insider: ReturnType<typeof insiderFacts> | null = null;
  if (insiders.ok) {
    insider = insiderFacts(insiders.envelope.data.rows, anchorDate, days);
    const fetched = insiders.envelope.data.rows;
    const oldest = fetched.map((row) => row.date).sort()[0];
    // Every fetched row inside the lookback while more exist: older ones in the lookback may be cut off.
    const truncated = fetched.length > 0 && insiders.envelope.data.total > fetched.length && oldest !== undefined && oldest >= insider.since;
    components.push({
      key: "insider", weight: 0, points: null, status: "ok", reason: null,
      raw: { lookbackDays: days, since: insider.since, transactions: insider.transactions, buys: insider.buys, sells: insider.sells, netShares: insider.netShares, latestDate: insider.latestDate, totalReported: insiders.envelope.data.total, truncated: truncated ? 1 : 0 },
      source: { table: table(insiders.envelope, "insiders"), asOf: insiders.envelope.asOf },
    });
  } else components.push(missing("insider", insiders.error, "insiders"));

  // volume (latest session vs the 20 sessions before it)
  const volume = volumeFacts(rows);
  if (history.ok && volume) {
    components.push({ key: "volume", weight: 0, raw: { ...volume }, points: null, status: sessionStatus(volume.session, now), reason: null, source: { table: table(history.envelope, "history"), asOf: history.envelope.asOf } });
  } else components.push(missing("volume", historyError, "history"));

  const fromPrice = merged.fromPrice && price.ok;
  const priceEnvelope = fromPrice && price.ok ? price.envelope : history.ok ? history.envelope : null;
  const priceSource = { table: priceEnvelope ? table(priceEnvelope, fromPrice ? "price" : "history") : "price", asOf: priceEnvelope?.asOf ?? merged.date };

  const checks: QualityCheck[] = [
    {
      key: "price_history",
      result: price.ok && latest && price.envelope.data.sessionDate === latest.date ? (price.envelope.data.lastPriceIdr === latest.close ? "match" : "mismatch") : "not_applicable",
    },
    {
      key: "foreign_sources",
      result: windows["1D"] && brokerForeign["1D"] && brokerForeign["1D"].end === windows["1D"].end
        ? Math.sign(windows["1D"].foreignNetShares) === Math.sign(brokerForeign["1D"].netValueIdr) ? "match" : "mismatch"
        : "not_applicable",
    },
    { key: "broker_windows", result: brokerOk === 0 || !latest ? "not_applicable" : windowMismatch ? "mismatch" : "match" },
  ];

  const sources: BriefSource[] = [];
  if (price.ok) sources.push({ table: table(price.envelope, "price"), asOf: price.envelope.asOf, rows: 1, range: null });
  if (history.ok) sources.push({ table: table(history.envelope, "history"), asOf: history.envelope.asOf, rows: rows.length, range: rows.length ? `${rows[0].date}/${rows.at(-1)!.date}` : null });
  if (brokerCells > 0) sources.push({ table: brokerTable, asOf: brokerAsOf, rows: brokerRows, range: brokerWindows[0]?.start ? `${brokerWindows.at(-1)!.start}/${brokerWindows[0].end}` : null });
  if (insiders.ok) sources.push({ table: table(insiders.envelope, "insiders"), asOf: insiders.envelope.asOf, rows: insiders.envelope.data.rows.length, range: insider ? `${insider.since}/${anchorDate}` : null });
  if (security && securities.ok) sources.push({ table: table(securities.envelope, "securities"), asOf: securities.envelope.asOf, rows: 1, range: null });

  const ok = components.filter((item) => item.status === "ok").length;
  return {
    code,
    name: searchMatch?.companyName ?? security?.companyName ?? null,
    sector: security?.sector ?? null,
    asOf: fromPrice && price.ok && price.envelope.asOf ? price.envelope.asOf : merged.date,
    freshness: sessionStatus(merged.date, now) === "ok" ? "fresh" : "stale",
    price: {
      last: merged.close, change: merged.change, changePct: merged.changePercent, window: "1D", session: merged.date, source: priceSource,
      meta: priceEnvelope ? { freshness: priceEnvelope.freshness, asOf: priceEnvelope.asOf, source: priceEnvelope.source } : { freshness: "UNAVAILABLE", asOf: null, source: source.id },
    },
    score: { value: null, confidence: Math.round((ok / components.length) * 100) / 100, version: "none" },
    windows: [...WINDOWS],
    components,
    insiderTransactions: (insider?.rows ?? []).map((row) => ({ date: row.date, person: row.person, action: row.action, roles: row.roles, changeShares: row.changeShares, priceIdr: row.priceIdr })),
    counterEvidence: counterEvidence({ windows, brokerForeign, insider: insider ? { facts: insider, price: priceChangeSince(rows, insider.since) } : null }),
    checks,
    sources,
    quota: { used: 0, limit: null, charged: false },
    generatedAt: now.toISOString(),
  };
}

// --- Per-ticker, per-trading-day cache --------------------------------------------------------------

const MAX_ENTRIES = 500;
/** While the session is in progress the price moves; elsewhere a brief holds for the day. */
const IN_SESSION_TTL_MS = 60_000;
/** A brief with a failed source is retried sooner than a complete one. */
const PARTIAL_TTL_MS = 5 * 60_000;

const cache = new Map<string, { brief: ResearchBrief; expires: number }>();
const inflight = new Map<string, Promise<ResearchBrief>>();

export function clearResearchCache(): void {
  cache.clear();
  inflight.clear();
}

/** Missing for a reason other than the data not existing anywhere yet (e.g. a provider error). */
const failedSource = (brief: ResearchBrief) => brief.components.some((item) => item.status === "missing" && item.reason !== "NOT_AVAILABLE" && item.reason !== "INSUFFICIENT_HISTORY" && item.reason !== "NO_CATEGORY_BREAKDOWN");

/**
 * Cached per source, ticker, lookback and Jakarta trading day. Concurrent requests share one build,
 * which is not tied to any single request's abort signal.
 */
export async function getResearchBrief(source: MarketDataSource, code: string, options: { days?: number; now?: () => Date } = {}): Promise<ResearchBrief> {
  const clock = options.now ?? (() => new Date());
  const now = clock();
  const day = jakartaClock(now).date;
  const key = `${source.id}:${code}:${options.days ?? 30}:${day}`;
  const hit = cache.get(key);
  if (hit && hit.expires > now.getTime()) return hit.brief;
  const pending = inflight.get(key);
  if (pending) return pending;
  const build = buildResearchBrief(source, code, { days: options.days, now }).then((brief) => {
    const inSession = marketPhase(jakartaClock(now)) === "in_progress";
    const ttl = failedSource(brief) ? PARTIAL_TTL_MS : inSession ? IN_SESSION_TTL_MS : Number.POSITIVE_INFINITY;
    // Entries from earlier days can never be hit again (the day is in the key).
    for (const [entryKey] of cache) if (!entryKey.endsWith(`:${day}`)) cache.delete(entryKey);
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
    cache.set(key, { brief, expires: now.getTime() + ttl });
    return brief;
  }).finally(() => inflight.delete(key));
  inflight.set(key, build);
  return build;
}
