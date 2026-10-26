// Signal confluence radar (/v1/radar) and the KSEI corporate-holder view (/v1/ownership/stealth), from stored rows
// only. Every threshold comes from the versioned rules in src/lib/radar/rules.ts, which the responses echo and the
// app's methodology page renders. Nothing here scores, predicts or labels: a signal either met its documented
// threshold or it did not, a signal without the data it needs is "missing" (never zero), and observations that point
// the other way are listed next to the ones that fired.
import type { z } from "zod";
import type { OwnershipChangeKind } from "@/lib/ownership/changes";
import {
  RADAR_RULES_V0, RADAR_SIGNAL_KEYS, STEALTH_RULES_V0, type RadarRules, type RadarSignalKey, type StealthRules,
} from "@/lib/radar/rules";
import type { radarCounterSchema, radarFiredSignalSchema, radarSchema, radarStockSchema, stealthHolderSchema, stealthOwnershipSchema, stealthStockSchema } from "@/server/schemas/idx-bei";
import { previousMonth } from "../ownership/numbers";
import type { ChangeRecord, OwnershipStore } from "../ownership/store";
import { sessionFreshness, type Served } from "./market";
import type { DailyRecord, MarketStore } from "./store";

type Radar = z.input<typeof radarSchema>;
type RadarStock = z.input<typeof radarStockSchema>;
type Fired = z.input<typeof radarFiredSignalSchema>;
type Counter = z.input<typeof radarCounterSchema>;
type Status = RadarStock["status"];

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const known = (value: number | null): value is number => value !== null && Number.isFinite(value);
const sign = (value: number) => (value > 0 ? 1 : value < 0 ? -1 : 0);
const round = (value: number, decimals = 6) => Math.round(value * 10 ** decimals) / 10 ** decimals;

/** Sessions a stock needs for every price/volume signal: the largest window or baseline plus the session before it. */
export function sessionsNeeded(rules: RadarRules = RADAR_RULES_V0): number {
  return Math.max(...Object.values(rules.signals).map((rule) => Math.max((rule.window ?? 0) + 1, (rule.baseline ?? 0) + 1)));
}

// ── Per-stock figures (rows ascending by date, the newest last) ─────────────────────────────────────────────────

export type ForeignWindow = { sessions: number; netShares: number; volume: number; netValueIdr: number; buySessions: number; sellSessions: number };

/** Net foreign flow over the newest `sessions` rows; null unless every one of them has foreign buy/sell and volume. */
export function foreignWindow(rows: DailyRecord[], sessions: number): ForeignWindow | null {
  if (rows.length < sessions) return null;
  const inside = rows.slice(-sessions);
  if (inside.some((row) => row.foreignBuy === null || row.foreignSell === null || row.volume === null)) return null;
  const nets = inside.map((row) => row.foreignBuy! - row.foreignSell!);
  return {
    sessions,
    netShares: nets.reduce((sum, net) => sum + net, 0),
    volume: inside.reduce((sum, row) => sum + row.volume!, 0),
    // Approximate rupiah value: each session's net shares at that session's close.
    netValueIdr: Math.round(inside.reduce((sum, row, index) => sum + nets[index] * row.close, 0)),
    buySessions: nets.filter((net) => net > 0).length,
    sellSessions: nets.filter((net) => net < 0).length,
  };
}

/** Close change (fraction) from the session before the window to the newest; null without that base close. */
export function priceChange(rows: DailyRecord[], sessions: number): number | null {
  if (rows.length < sessions + 1) return null;
  const base = rows[rows.length - sessions - 1].close;
  return base > 0 ? rows[rows.length - 1].close / base - 1 : null;
}

/** Newest value ÷ the mean of the `baseline` sessions before it; null when any of those values is missing. */
function againstBaseline(rows: DailyRecord[], baseline: number, pick: (row: DailyRecord) => number | null): number | null {
  if (rows.length < baseline + 1) return null;
  const latest = pick(rows[rows.length - 1]);
  const before = rows.slice(-(baseline + 1), -1).map(pick);
  if (!known(latest) || !before.every(known)) return null;
  const average = mean(before as number[]);
  return average > 0 ? latest / average : null;
}

const valuePerTrade = (row: DailyRecord) => (row.value !== null && row.frequency !== null && row.frequency > 0 ? row.value / row.frequency : null);

/** Newest session change against its previous close (fraction). */
export function sessionChange(rows: DailyRecord[]): number | null {
  const latest = rows.at(-1);
  if (!latest) return null;
  const previous = latest.previousClose ?? rows.at(-2)?.close ?? null;
  return previous ? latest.close / previous - 1 : null;
}

export type KseiCounts = { increases: number; decreases: number };
/** The newest uploaded month and, per symbol listed in it, how many ≥1% holders increased or decreased. */
export type KseiInput = { month: string; bySymbol: Map<string, KseiCounts> } | null;

const windowKey = (sessions: number) => `${sessions}D`;

/**
 * Evaluates every signal of one stock. `rows` are its stored sessions within the radar's lookback, ascending, the
 * newest being the trading date. Returns what fired, the counter-evidence and each signal's data status.
 */
export function evaluateStock(rows: DailyRecord[], symbol: string, ksei: KseiInput, rules: RadarRules = RADAR_RULES_V0): Pick<RadarStock, "fired" | "counter" | "status"> {
  const fired: Fired[] = [];
  const counter: Counter[] = [];
  const status = {} as Status;
  const s = rules.signals;
  const record = (key: RadarSignalKey, observed: number | null, window: string, detail: Record<string, number | null> = {}) => {
    status[key] = observed === null ? "missing" : "ok";
    if (observed !== null && observed >= s[key].threshold) fired.push({ key, observed: round(observed), threshold: s[key].threshold, window, detail });
  };

  const foreignShare = (flow: ForeignWindow | null) => (flow && flow.volume > 0 ? flow.netShares / flow.volume : null);
  const flowDetail = (flow: ForeignWindow | null): Record<string, number | null> => (flow ?{ netShares: flow.netShares, netValueIdr: flow.netValueIdr, buySessions: flow.buySessions, sellSessions: flow.sellSessions } : {});
  const foreign5 = foreignWindow(rows, s.foreignNetBuy5.window);
  const foreign20 = foreignWindow(rows, s.foreignNetBuy20.window);
  record("foreignNetBuy5", foreignShare(foreign5), windowKey(s.foreignNetBuy5.window), flowDetail(foreign5));
  record("foreignNetBuy20", foreignShare(foreign20), windowKey(s.foreignNetBuy20.window), flowDetail(foreign20));

  const volumeRatio = againstBaseline(rows, s.volumeSpike.baseline, (row) => row.volume);
  record("volumeSpike", volumeRatio, windowKey(s.volumeSpike.window), { volume: rows.at(-1)?.volume ?? null });

  const closes = rows.slice(-s.closeAboveAverage.baseline);
  const average = closes.length === s.closeAboveAverage.baseline ? mean(closes.map((row) => row.close)) : null;
  record("closeAboveAverage", average ? rows.at(-1)!.close / average - 1 : null, windowKey(s.closeAboveAverage.window), { close: rows.at(-1)?.close ?? null, average: average === null ? null : round(average, 2) });

  const change5 = priceChange(rows, s.priceUp5.window);
  record("priceUp5", change5, windowKey(s.priceUp5.window));

  const orderRatio = againstBaseline(rows, s.orderSizeSpike.baseline, valuePerTrade);
  const latestOrder = rows.length ? valuePerTrade(rows.at(-1)!) : null;
  record("orderSizeSpike", orderRatio, windowKey(s.orderSizeSpike.window), { valuePerTradeIdr: latestOrder === null ? null : Math.round(latestOrder) });

  const counts = ksei?.bySymbol.get(symbol) ?? null;
  record("kseiHolderIncrease", counts ? counts.increases : null, ksei?.month ?? "0000-00", counts ? { increases: counts.increases, decreases: counts.decreases } : {});

  // Counter-evidence: observed whatever fired.
  for (const [key, flow] of [["priceVsForeign5", foreign5], ["priceVsForeign20", foreign20]] as const) {
    const sessions = rules.counter[key].window;
    const change = priceChange(rows, sessions);
    if (change !== null && flow && sign(change) !== 0 && sign(flow.netShares) !== 0 && sign(change) !== sign(flow.netShares)) {
      counter.push({ key, window: windowKey(sessions), values: { priceChange: round(change), foreignNetShares: flow.netShares } });
    }
  }
  const dayChange = sessionChange(rows);
  if (volumeRatio !== null && volumeRatio >= s.volumeSpike.threshold && dayChange !== null && dayChange < 0) {
    counter.push({ key: "volumeOnDownSession", window: windowKey(rules.counter.volumeOnDownSession.window), values: { volumeRatio: round(volumeRatio), changePercent: round(dayChange) } });
  }
  if (counts && ksei && counts.decreases >= rules.counter.kseiHolderDecrease.threshold) {
    counter.push({ key: "kseiHolderDecrease", window: ksei.month, values: { decreases: counts.decreases, increases: counts.increases } });
  }
  return { fired, counter, status };
}

/** Holder changes of the newest month counted per symbol (INCREASE and DECREASE only; NEW has no known prior holding). */
export function kseiCounts(month: string, symbols: string[], changes: Array<Pick<ChangeRecord, "symbol" | "kind">>): KseiInput {
  const bySymbol = new Map<string, KseiCounts>(symbols.map((symbol) => [symbol, { increases: 0, decreases: 0 }]));
  for (const change of changes) {
    const counts = bySymbol.get(change.symbol);
    if (!counts) continue;
    if (change.kind === "INCREASE") counts.increases += 1;
    if (change.kind === "DECREASE") counts.decreases += 1;
  }
  return { month, bySymbol };
}

type Meta = { name: string | null; sector: string | null };

/** The radar over prepared inputs: every stock with a row on `tradingDate` (restricted to `meta` when it lists any). */
export function buildRadar(rows: DailyRecord[], tradingDate: string, meta: Map<string, Meta>, ksei: KseiInput, rules: RadarRules = RADAR_RULES_V0): Radar {
  const bySymbol = new Map<string, DailyRecord[]>();
  for (const row of rows) bySymbol.set(row.symbol, [...(bySymbol.get(row.symbol) ?? []), row]);
  const coverage = Object.fromEntries(RADAR_SIGNAL_KEYS.map((key) => [key, 0])) as Record<RadarSignalKey, number>;
  const evaluated: RadarStock[] = [];
  for (const [symbol, history] of bySymbol) {
    history.sort((a, b) => a.date.localeCompare(b.date));
    const latest = history.at(-1)!;
    if (latest.date !== tradingDate) continue;
    if (meta.size && !meta.has(symbol)) continue;
    const result = evaluateStock(history, symbol, ksei, rules);
    for (const key of RADAR_SIGNAL_KEYS) if (result.status[key] === "ok") coverage[key] += 1;
    const info = meta.get(symbol);
    evaluated.push({
      symbol, name: info?.name ?? null, sector: info?.sector ?? null, close: latest.close, changePercent: sessionChange(history), value: latest.value,
      ...result, firedCount: result.fired.length,
    });
  }
  const listed = evaluated.filter((stock) => stock.firedCount > 0)
    .sort((a, b) => b.firedCount - a.firedCount || (b.value ?? -1) - (a.value ?? -1) || a.symbol.localeCompare(b.symbol));
  const stocks = listed.slice(0, rules.listLimit);
  return {
    tradingDate, rulesVersion: rules.version, rules: rulesEcho(rules), kseiMonth: ksei?.month ?? null,
    coverage: { stocks: evaluated.length, listed: listed.length, returned: stocks.length, signals: coverage },
    stocks,
  };
}

export function rulesEcho(rules: RadarRules = RADAR_RULES_V0): Radar["rules"] {
  return Object.fromEntries(RADAR_SIGNAL_KEYS.map((key) => {
    const { window, baseline, threshold, unit } = rules.signals[key];
    return [key, { window, baseline, threshold, unit }];
  })) as Radar["rules"];
}

/** The contract's empty form (no session stored yet): UNAVAILABLE, with the rules still echoed. */
export function emptyRadar(rules: RadarRules = RADAR_RULES_V0): Radar {
  return {
    tradingDate: null, rulesVersion: rules.version, rules: rulesEcho(rules), kseiMonth: null,
    coverage: { stocks: 0, listed: 0, returned: 0, signals: Object.fromEntries(RADAR_SIGNAL_KEYS.map((key) => [key, 0])) as Record<RadarSignalKey, number> },
    stocks: [],
  };
}

export async function serveRadar(market: MarketStore, ownership: OwnershipStore | null, now: Date, rules: RadarRules = RADAR_RULES_V0): Promise<Served<Radar> | null> {
  const tradingDate = await market.latestSessionDate();
  if (!tradingDate) return null;
  const [rows, securities, month] = await Promise.all([
    market.sessionHistory(tradingDate, sessionsNeeded(rules)), market.searchSecurities("", 10_000), ownership?.latestMonth() ?? Promise.resolve(null),
  ]);
  const meta = new Map(securities.map((row) => [row.symbol, { name: row.name, sector: row.sector }]));
  let ksei: KseiInput = null;
  if (ownership && month) {
    const [sets, changes] = await Promise.all([ownership.setsInMonth(month), ownership.changes(month)]);
    ksei = kseiCounts(month, sets.map((set) => set.symbol), changes);
  }
  return { data: buildRadar(rows, tradingDate, meta, ksei, rules), dataAsOf: tradingDate, freshness: sessionFreshness(tradingDate, now) };
}

// ── /v1/ownership/stealth ───────────────────────────────────────────────────────────────────────────────────────

type Stealth = z.input<typeof stealthOwnershipSchema>;
type StealthStock = z.input<typeof stealthStockSchema>;
type StealthHolder = z.input<typeof stealthHolderSchema>;

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
/** Kinds with a known share delta between the two months. */
const COMPARED: ReadonlySet<OwnershipChangeKind> = new Set(["INCREASE", "DECREASE", "UNCHANGED", "EXIT"]);

export type CloseAt = { date: string; close: number };

/**
 * Corporate holders' changes of one issuer: the sum of known share deltas, newly listed holders (not summed: their
 * earlier holding is unknown), and every corporate holder that changed (incl. those that fell below the threshold).
 */
export function corporateChanges(changes: ChangeRecord[], typeOf: (change: ChangeRecord) => string | null, rules: StealthRules = STEALTH_RULES_V0) {
  const corporate = changes.filter((change) => {
    const type = typeOf(change);
    return type !== null && (rules.investorTypes as readonly string[]).includes(type);
  });
  let delta = BigInt(0);
  for (const change of corporate) if (COMPARED.has(change.kind) && change.shareDelta !== null) delta += BigInt(change.shareDelta);
  const newHolders = corporate.filter((change) => change.kind === "NEW").length;
  const holders: StealthHolder[] = corporate.filter((change) => change.kind !== "UNCHANGED").map((change) => ({
    holderKey: change.holderKey, holderName: change.holderName, investorType: typeOf(change)!, kind: change.kind,
    sharesBefore: change.sharesBefore, sharesAfter: change.sharesAfter, shareDelta: change.shareDelta,
    percentBefore: change.percentBefore, percentAfter: change.percentAfter, ppDelta: change.ppDelta, flags: change.flags,
  }));
  return { delta, newHolders, holders, increased: delta > BigInt(0) || (delta === BigInt(0) && newHolders > 0) };
}

/** Close change between the two position dates, or null when either close is missing or too far from its date. */
export function priceBetween(from: CloseAt | undefined, fromDate: string, to: CloseAt | undefined, toDate: string, rules: StealthRules = STEALTH_RULES_V0): StealthStock["price"] {
  if (!from || !to || from.close <= 0) return null;
  const gap = rules.maxCloseGapDays;
  if (daysBetween(from.date, fromDate) > gap || daysBetween(to.date, toDate) > gap || from.date >= to.date) return null;
  return { from, to, changePercent: round(to.close / from.close - 1) };
}

export function emptyStealth(rules: StealthRules = STEALTH_RULES_V0): Stealth {
  return {
    month: null, previousMonth: null, rulesVersion: rules.version,
    rules: { investorTypes: [...rules.investorTypes], maxPriceChange: rules.maxPriceChange, maxCloseGapDays: rules.maxCloseGapDays },
    coverage: { issuers: 0, corporateIncrease: 0, priceRose: 0, priceMissing: 0 }, stocks: [],
  };
}

export async function serveStealth(ownership: OwnershipStore, market: MarketStore | null, rules: StealthRules = STEALTH_RULES_V0): Promise<Served<Stealth> | null> {
  const month = await ownership.latestMonth();
  if (!month) return null;
  const [sets, changes] = await Promise.all([ownership.setsInMonth(month), ownership.changes(month)]);
  if (!sets.length) return null;
  const types = await ownership.holderTypes([...new Set(changes.flatMap((change) => [change.toSetId, change.fromSetId]))]);
  const typeBySet = new Map<string, string | null>();
  for (const row of types) {
    const key = `${row.setId}|${row.holderKey}`;
    if (!typeBySet.get(key)) typeBySet.set(key, row.investorType);
  }
  // The newer month's stated type first; the earlier month's for holders no longer listed.
  const typeOf = (change: ChangeRecord) => typeBySet.get(`${change.toSetId}|${change.holderKey}`) ?? typeBySet.get(`${change.fromSetId}|${change.holderKey}`) ?? null;

  const bySymbol = new Map<string, ChangeRecord[]>();
  for (const change of changes) bySymbol.set(change.symbol, [...(bySymbol.get(change.symbol) ?? []), change]);
  const candidates = [...bySymbol.entries()].map(([symbol, list]) => ({ symbol, list, ...corporateChanges(list, typeOf, rules) })).filter((item) => item.increased);

  const symbols = candidates.map((item) => item.symbol);
  const toDates = [...new Set(candidates.map((item) => item.list[0].toDate))];
  const fromDates = [...new Set(candidates.map((item) => item.list[0].fromDate))];
  const closes = new Map<string, Map<string, CloseAt>>();
  if (market && symbols.length) {
    for (const date of new Set([...toDates, ...fromDates])) closes.set(date, await market.closesOnOrBefore(date, symbols));
  }
  const issuerName = new Map(sets.map((set) => [set.symbol, set.issuerName]));
  const coverage = { issuers: sets.length, corporateIncrease: candidates.length, priceRose: 0, priceMissing: 0 };
  const listed: Array<StealthStock & { sortKey: number }> = [];
  for (const item of candidates) {
    const { fromDate, toDate } = item.list[0];
    const price = priceBetween(closes.get(fromDate)?.get(item.symbol), fromDate, closes.get(toDate)?.get(item.symbol), toDate, rules);
    if (price && price.changePercent > rules.maxPriceChange) { coverage.priceRose += 1; continue; }
    if (!price) coverage.priceMissing += 1;
    // Ordering only: the summed percentage-point change of the corporate holders with a known before and after.
    const sortKey = item.holders.reduce((sum, holder) => sum + (holder.ppDelta !== null && COMPARED.has(holder.kind) ? Number(holder.ppDelta) : 0), 0);
    listed.push({
      symbol: item.symbol, name: issuerName.get(item.symbol) ?? null, fromDate, toDate,
      combinedShareDelta: item.delta.toString(), newHolders: item.newHolders, holders: item.holders, price, sortKey,
    });
  }
  listed.sort((a, b) => Number(b.price !== null) - Number(a.price !== null) || b.sortKey - a.sortKey || a.symbol.localeCompare(b.symbol));
  return {
    data: {
      month, previousMonth: previousMonth(month), rulesVersion: rules.version,
      rules: { investorTypes: [...rules.investorTypes], maxPriceChange: rules.maxPriceChange, maxCloseGapDays: rules.maxCloseGapDays },
      coverage, stocks: listed.slice(0, rules.listLimit).map(({ sortKey: _sortKey, ...stock }) => stock),
    },
    dataAsOf: sets.map((set) => set.snapshotDate).sort().at(-1)!,
    freshness: "HISTORICAL",
  };
}
