// /v1/stocks/{s}/fundamentals and POST /v1/screener (E5). Pure functions over a MarketStore; the HTTP layer
// validates every result with the shared Zod schemas before it leaves the engine.
//   Fundamentals: one entry per (period end, period type), newest first, annual before quarterly on the same date.
//   Metrics as stored (filing currency, as reported), with each metric's unit. dataAsOf = the newest period end.
//   Screener: every stock with a row in the newest session. Values are never invented: a missing input is null,
//   and a condition on a null value is false. Ratios come from `derived` stock_ratios rows, else from Pasardana's
//   own (`ratioSources` says which, per symbol and field). `change1D` and the ratio fractions are fractions.
import type { z } from "zod";
import { SCREEN_FIELDS, type fundamentalsSchema, type screenConditionSchema, type screenResultSchema } from "@/server/schemas/idx-bei";
import { sessionFreshness, type Served } from "./market";
import type { DailyRecord, FundamentalRecord, MarketStore, RatioRecord } from "./store";

type ScreenField = (typeof SCREEN_FIELDS)[number];
type ScreenCondition = z.infer<typeof screenConditionSchema>;
type ScreenResult = z.input<typeof screenResultSchema>;

/** Statement sources in order of preference, when several stored the same line. */
export const FUNDAMENTALS_SOURCES = ["yahoo-fundamentals"];
const RATIO_FIELDS = ["per", "pbv", "roe", "roa", "eps", "der", "dividendYield"] as const satisfies readonly ScreenField[];

/** Trailing sessions used for relativeVolume (volume vs its average) and pctFromHigh (close vs the period high). */
const VOLUME_WINDOW = 20;
/** Minimum prior sessions before the window metrics are reported (too few is noise, not a signal). */
const VOLUME_MIN_SESSIONS = 5;

/** relativeVolume and pctFromHigh from a symbol's prior sessions; nulls when there is too little history. */
function windowMetrics(prior: DailyRecord[] | undefined, day: DailyRecord): { relativeVolume: number | null; pctFromHigh: number | null } {
  const bars = (prior ?? []).slice(-VOLUME_WINDOW);
  if (bars.length < VOLUME_MIN_SESSIONS) return { relativeVolume: null, pctFromHigh: null };
  const volumes = bars.map((bar) => bar.volume).filter((v): v is number => v !== null && v > 0);
  const avgVolume = volumes.length ? volumes.reduce((sum, v) => sum + v, 0) / volumes.length : null;
  const highs = bars.map((bar) => bar.high ?? bar.close).filter((h): h is number => h !== null && h > 0);
  const priorHigh = highs.length ? Math.max(...highs) : null;
  return {
    relativeVolume: avgVolume && day.volume !== null ? day.volume / avgVolume : null,
    // Fraction like change1D: 0 = closed exactly at the prior high, > 0 = broke above it (breakout), < 0 = below.
    pctFromHigh: priorHigh ? day.close / priorHigh - 1 : null,
  };
}

const unitLabel = (row: FundamentalRecord) => (row.unit === "shares" ? "shares" : row.unit === "per_share" ? `${row.currency ?? "?"}/share` : row.currency ?? "?");
const sourceRank = (source: string) => (FUNDAMENTALS_SOURCES.includes(source) ? FUNDAMENTALS_SOURCES.indexOf(source) : FUNDAMENTALS_SOURCES.length);

// ── /v1/stocks/{s}/fundamentals ─────────────────────────────────────────────────────────────────────────────────

export async function serveFundamentals(store: MarketStore, symbol: string): Promise<Served<z.input<typeof fundamentalsSchema>> | null> {
  const rows = await store.fundamentals(symbol);
  if (!rows.length) return null;
  const periods = new Map<string, { periodEnd: string; periodType: FundamentalRecord["periodType"]; lines: Map<string, FundamentalRecord> }>();
  for (const row of rows) {
    const key = `${row.periodEnd}|${row.periodType}`;
    if (!periods.has(key)) periods.set(key, { periodEnd: row.periodEnd, periodType: row.periodType, lines: new Map() });
    const lines = periods.get(key)!.lines;
    const held = lines.get(row.metric);
    if (!held || sourceRank(row.source) < sourceRank(held.source)) lines.set(row.metric, row);
  }
  const data = [...periods.values()]
    .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.periodType.localeCompare(b.periodType))
    .map((period) => {
      const lines = [...period.lines.values()].sort((a, b) => a.metric.localeCompare(b.metric));
      const currencies = [...new Set(lines.map((line) => line.currency).filter((currency): currency is string => currency !== null))];
      const sources = [...new Set(lines.map((line) => line.source))];
      return {
        periodDate: period.periodEnd, periodType: period.periodType.toUpperCase(),
        metrics: Object.fromEntries(lines.map((line) => [line.metric, line.value])),
        units: Object.fromEntries(lines.map((line) => [line.metric, unitLabel(line)])),
        currency: currencies.length === 1 ? currencies[0] : null,
        source: sources.join("+"),
      };
    });
  // Statements are historical by nature: the app labels them HISTORICAL with the newest period end.
  return { data, dataAsOf: data[0].periodDate, freshness: "HISTORICAL" };
}

// ── POST /v1/screener ───────────────────────────────────────────────────────────────────────────────────────────

export type ScreenValues = Record<ScreenField, number | null>;

const EPSILON = 1e-9;

/** One condition on one value; a null value never matches (it is unknown, not zero). */
export function conditionHolds(condition: Pick<ScreenCondition, "operator" | "value">, value: number | null): boolean {
  if (value === null || !Number.isFinite(value)) return false;
  switch (condition.operator) {
    case "GT": return value > condition.value;
    case "GTE": return value >= condition.value;
    case "LT": return value < condition.value;
    case "LTE": return value <= condition.value;
    case "EQ": return Math.abs(value - condition.value) <= EPSILON * Math.max(1, Math.abs(value), Math.abs(condition.value));
  }
}

/**
 * Evaluates conditions with the usual precedence: AND binds tighter than OR, so `a AND b OR c AND d` is
 * `(a ∧ b) ∨ (c ∧ d)`. The first condition's connective is ignored. No conditions match everything.
 */
export function matchesConditions(conditions: ScreenCondition[], values: ScreenValues): boolean {
  if (!conditions.length) return true;
  let any = false;
  let group = true;
  conditions.forEach((condition, index) => {
    if (index > 0 && condition.connective === "OR") { any ||= group; group = true; }
    group &&= conditionHolds(condition, values[condition.field]);
  });
  return any || group;
}

/** Prefer locally-derived ratios, then official IDX, then Pasardana fallback; null values still reserve precedence. */
export function pickRatio(rows: RatioRecord[]): RatioRecord | null {
  return rows.find((row) => row.ratioSource === "derived") ?? rows.find((row) => row.ratioSource === "idx") ?? rows.find((row) => row.ratioSource === "pasardana") ?? null;
}

export async function serveScreener(store: MarketStore, request: { conditions: ScreenCondition[]; limit: number }, now: Date): Promise<Served<ScreenResult> | null> {
  const session = await store.latestSessionDate();
  if (!session) return null;
  const daily = await store.sessionRows(session);
  if (!daily.length) return null;
  const symbols = daily.map((row) => row.symbol);
  // The trailing window feeds relativeVolume and pctFromHigh (breakout). +1 session so the current day's own row can
  // be excluded, leaving VOLUME_WINDOW prior sessions.
  const [securities, ratioRows, history] = await Promise.all([
    store.securities(symbols), store.ratios(symbols), store.sessionHistory(session, VOLUME_WINDOW + 1),
  ]);
  const bySymbol = new Map(securities.map((row) => [row.symbol, row]));
  const ratios = new Map<string, RatioRecord[]>();
  for (const row of ratioRows) {
    const key = `${row.symbol}|${row.ratio}`;
    if (!ratios.has(key)) ratios.set(key, []);
    ratios.get(key)!.push(row);
  }
  // Prior sessions (strictly before the current one) per symbol, for the window metrics.
  const priorBars = new Map<string, DailyRecord[]>();
  for (const row of history) {
    if (row.date >= session) continue;
    if (!priorBars.has(row.symbol)) priorBars.set(row.symbol, []);
    priorBars.get(row.symbol)!.push(row);
  }

  const rows = daily.map((day) => {
    const security = bySymbol.get(day.symbol);
    const shares = security?.sharesOutstanding ?? null;
    const values: ScreenValues = {
      price: day.close, volume: day.volume, value: day.value, frequency: day.frequency,
      foreignNetShares: day.foreignBuy !== null && day.foreignSell !== null ? day.foreignBuy - day.foreignSell : null,
      // Net foreign value in IDR (net shares × close): the "foreign accumulation" ranking traders screen on.
      foreignNetValue: day.foreignBuy !== null && day.foreignSell !== null ? (day.foreignBuy - day.foreignSell) * day.close : null,
      marketCap: shares ? day.close * shares : security?.marketCap ?? null,
      change1D: day.previousClose ? day.close / day.previousClose - 1 : null,
      ...windowMetrics(priorBars.get(day.symbol), day),
      per: null, pbv: null, roe: null, roa: null, eps: null, der: null, dividendYield: null,
    };
    const sources: Record<string, "derived" | "idx" | "pasardana"> = {};
    for (const field of RATIO_FIELDS) {
      const picked = pickRatio(ratios.get(`${day.symbol}|${field}`) ?? []);
      if (!picked) continue;
      values[field] = picked.value;
      sources[field] = picked.ratioSource;
    }
    return { symbol: day.symbol, name: security?.name ?? null, values, sources };
  });

  const supportedFields = SCREEN_FIELDS.filter((field) => rows.some((row) => row.values[field] !== null));
  const matched = rows.filter((row) => matchesConditions(request.conditions, row.values))
    // Most traded first (the app's default sort), symbols without a value last.
    .sort((a, b) => (b.values.value ?? -Infinity) - (a.values.value ?? -Infinity) || a.symbol.localeCompare(b.symbol));
  const page = matched.slice(0, request.limit);
  return {
    data: {
      // Zod's catchall input type can't express "symbol: string plus numeric fields"; the envelope re-validates it.
      rows: page.map((row) => ({ symbol: row.symbol, name: row.name, ...row.values })) as unknown as ScreenResult["rows"],
      total: matched.length,
      supportedFields,
      ratioSources: Object.fromEntries(page.filter((row) => Object.keys(row.sources).length).map((row) => [row.symbol, row.sources])),
    },
    dataAsOf: session, freshness: sessionFreshness(session, now),
  };
}
