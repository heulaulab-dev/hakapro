import type { StockSectorRotation } from "@/server/schemas/idx-bei";
import { computeRotation, minObservations, RRG_PARAM_DEFAULTS, type ClosePoint, type RrgInterval } from "@/lib/sector-rotation";
import { sessionFreshness, type Served } from "./market";
import type { DailyRecord, MarketStore } from "./store";

const MAX_UNIVERSE = 2_500;
const MAX_ISSUERS = 50;
const MAX_TAIL = 12;
const MIN_LIQUIDITY_DAYS = 15;
const LIQUIDITY_DAYS = 20;
const HISTORY_SESSIONS = 252;

type PriceRow = Pick<DailyRecord, "symbol" | "date" | "close" | "value">;

export type LiquidIssuer = { symbol: string; meanValue: number };
type CloseIndex = Map<string, Map<string, number>>;

function indexCloses(rows: PriceRow[]): CloseIndex {
  const bySymbol: CloseIndex = new Map();
  for (const row of rows) {
    if (!Number.isFinite(row.close) || row.close <= 0) continue;
    const series = bySymbol.get(row.symbol) ?? new Map<string, number>();
    series.set(row.date, row.close);
    bySymbol.set(row.symbol, series);
  }
  return bySymbol;
}

/** Mean traded value over the newest sessions, with a deterministic tie-break. */
export function rankLiquidIssuers(symbols: string[], rows: PriceRow[], sessions: number, minimumDays: number): LiquidIssuer[] {
  const allowed = new Set(symbols);
  const values = new Map<string, number[]>();
  for (const row of rows) {
    if (!allowed.has(row.symbol) || row.value === null || !Number.isFinite(row.value) || row.value <= 0) continue;
    const history = values.get(row.symbol) ?? [];
    history.push(row.value);
    values.set(row.symbol, history);
  }
  return [...values.entries()]
    .filter(([, history]) => history.length >= minimumDays)
    .map(([symbol, history]) => ({ symbol, meanValue: history.slice(-sessions).reduce((sum, value) => sum + value, 0) / history.slice(-sessions).length }))
    .sort((a, b) => b.meanValue - a.meanValue || a.symbol.localeCompare(b.symbol));
}

/**
 * Synthetic equal-weight sector-peer index. Returns are calculated only from exact stored endpoint closes;
 * gaps stay null. When a date lacks enough peers, the next accepted point measures from the last accepted
 * benchmark date, rather than carrying forward a price or inventing the missing daily return.
 */
export function buildPeerBasket(target: string, memberSymbols: string[], dates: string[], rows: PriceRow[]) {
  return buildPeerBasketFromIndex(target, memberSymbols, dates, indexCloses(rows));
}

function buildPeerBasketFromIndex(target: string, memberSymbols: string[], dates: string[], bySymbol: CloseIndex) {
  const peerSymbols = memberSymbols.filter((symbol) => symbol !== target);
  const minPeers = peerSymbols.length === 0 ? 0 : Math.min(5, Math.max(2, Math.ceil(peerSymbols.length * 0.2)));
  const out: ClosePoint[] = dates.map((date) => ({ date, close: null }));
  let anchorIndex = -1;
  let level = 100;
  let validIntervals = 0;

  for (let index = 0; index < dates.length; index++) {
    const date = dates[index]!;
    if (anchorIndex < 0) {
      const available = peerSymbols.reduce((count, symbol) => count + (bySymbol.get(symbol)?.has(date) ? 1 : 0), 0);
      if (available >= minPeers && minPeers > 0) {
        out[index] = { date, close: level };
        anchorIndex = index;
      }
      continue;
    }
    const from = dates[anchorIndex]!;
    const returns: number[] = [];
    for (const symbol of peerSymbols) {
      const prices = bySymbol.get(symbol);
      const start = prices?.get(from);
      const end = prices?.get(date);
      if (start !== undefined && end !== undefined && start > 0 && end > 0) returns.push(end / start - 1);
    }
    if (returns.length < minPeers) continue;
    const basketReturn = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    if (!Number.isFinite(basketReturn) || basketReturn <= -1) continue;
    level *= 1 + basketReturn;
    out[index] = { date, close: level };
    anchorIndex = index;
    validIntervals++;
  }

  return {
    peers: peerSymbols.length,
    minPeers,
    series: out,
    validIntervals,
    coveragePercent: dates.length < 2 ? 0 : (validIntervals / (dates.length - 1)) * 100,
  };
}

function emptyData(sector: string, sectors: StockSectorRotation["sectors"], interval: RrgInterval, requiredObservations: number): StockSectorRotation {
  return {
    sector, sectors, interval, from: null, to: null, sessions: 0,
    universe: { activeMembers: 0, eligibleIssuers: 0, returnedIssuers: 0, truncated: false },
    minPeerConstituents: 0, requiredObservations, stocks: [],
  };
}

/** Compute RRG only from the latest uninterrupted run of exact issuer and basket closes. */
function latestContinuousRotation(symbol: string, name: string, dates: string[], stockRows: PriceRow[], basketSeries: ClosePoint[], interval: RrgInterval) {
  const stockByDate = new Map(stockRows.map((row) => [row.date, row.close]));
  const basketByDate = new Map(basketSeries.filter((row) => row.close !== null).map((row) => [row.date, row.close!]));
  let segment: Array<{ date: string; stock: number; basket: number }> = [];
  for (const date of dates) {
    const stock = stockByDate.get(date);
    const basket = basketByDate.get(date);
    if (stock === undefined || basket === undefined || stock <= 0 || basket <= 0) {
      segment = [];
      continue;
    }
    segment.push({ date, stock, basket });
  }

  const result = computeRotation(
    { id: "SYNTHETIC:SECTOR-PEERS", series: segment.map(({ date, basket }) => ({ date, close: basket })) },
    [{ id: symbol, name, series: segment.map(({ date, stock }) => ({ date, close: stock })) }],
    interval,
  );
  return { rotation: result.rotations[0]!, alignedObservations: result.coverage[0]?.aligned ?? 0 };
}

export async function serveStockSectorRotation(
  store: MarketStore, requestedSector: string, interval: RrgInterval, now: Date,
): Promise<Served<StockSectorRotation> | null> {
  const endDate = await store.latestSessionDate();
  if (!endDate) return null;

  const fetchedSecurities = await store.searchSecurities("", MAX_UNIVERSE + 1);
  const truncated = fetchedSecurities.length > MAX_UNIVERSE;
  const securities = fetchedSecurities.slice(0, MAX_UNIVERSE);
  const membersBySector = new Map<string, typeof securities>();
  for (const security of securities) {
    const name = security.sector?.trim();
    if (!name) continue;
    const key = name.toLocaleLowerCase("id-ID");
    const list = membersBySector.get(key) ?? [];
    list.push(security);
    membersBySector.set(key, list);
  }
  const sectors = [...membersBySector.entries()]
    .map(([key, members]) => ({ key, name: members[0]!.sector!.trim(), members: members.length }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const selected = requestedSector.trim().toLocaleLowerCase("id-ID") === "all"
    ? [...sectors].sort((a, b) => b.members - a.members || a.name.localeCompare(b.name))[0]
    : sectors.find((item) => item.name.toLocaleLowerCase("id-ID") === requestedSector.trim().toLocaleLowerCase("id-ID"));
  const params = RRG_PARAM_DEFAULTS[interval];
  const requiredObservations = minObservations(params);
  if (!selected) {
    const empty = emptyData(requestedSector, sectors.map(({ name, members }) => ({ name, members })), interval, requiredObservations);
    return { data: empty, dataAsOf: endDate, freshness: sessionFreshness(endDate, now) };
  }

  const members = membersBySector.get(selected.key)!;
  const warmup = Math.max(RRG_PARAM_DEFAULTS.daily.smooth + RRG_PARAM_DEFAULTS.daily.normWindow + RRG_PARAM_DEFAULTS.daily.momentumWindow, 40);
  const dates = (await store.sessionDates(endDate, HISTORY_SESSIONS + warmup + 1)).reverse();
  if (dates.length < 2) {
    const empty = emptyData(selected.name, sectors.map(({ name, members }) => ({ name, members })), interval, requiredObservations);
    return { data: { ...empty, to: endDate, universe: { ...empty.universe, activeMembers: members.length, truncated } }, dataAsOf: endDate, freshness: sessionFreshness(endDate, now) };
  }

  const symbols = members.map(({ symbol }) => symbol);
  const rows = await store.dailyRowsBetween(dates[0]!, endDate, symbols);
  const liquidityStart = Math.max(0, dates.length - LIQUIDITY_DAYS);
  const liquidityDates = new Set(dates.slice(liquidityStart));
  const liquidityRows = rows.filter((row) => liquidityDates.has(row.date));
  const eligible = rankLiquidIssuers(symbols, liquidityRows, LIQUIDITY_DAYS, MIN_LIQUIDITY_DAYS);
  const selectedIssuers = eligible.slice(0, MAX_ISSUERS);
  const bySymbol = new Map<string, PriceRow[]>();
  for (const row of rows) {
    const list = bySymbol.get(row.symbol) ?? [];
    list.push(row);
    bySymbol.set(row.symbol, list);
  }
  const securityBySymbol = new Map(members.map((security) => [security.symbol, security]));
  const closeIndex = indexCloses(rows);
  const stocks = selectedIssuers.map(({ symbol }) => {
    const basket = buildPeerBasketFromIndex(symbol, symbols, dates, closeIndex);
    const stockRows = bySymbol.get(symbol) ?? [];
    const { rotation, alignedObservations } = latestContinuousRotation(symbol, securityBySymbol.get(symbol)?.name ?? symbol, dates, stockRows, basket.series, interval);
    const lastPoints = rotation.points.slice(-MAX_TAIL);
    return {
      symbol,
      name: securityBySymbol.get(symbol)?.name ?? symbol,
      peers: basket.peers,
      basketCoveragePercent: Math.round(basket.coveragePercent * 10) / 10,
      alignedObservations,
      latest: rotation.latest,
      points: lastPoints,
    };
  });

  const data: StockSectorRotation = {
    sector: selected.name,
    sectors: sectors.map(({ name, members }) => ({ name, members })),
    interval, from: dates[0]!, to: endDate, sessions: dates.length - 1,
    universe: { activeMembers: members.length, eligibleIssuers: eligible.length, returnedIssuers: selectedIssuers.length, truncated },
    minPeerConstituents: members.length <= 1 ? 0 : Math.min(5, Math.max(2, Math.ceil((members.length - 1) * 0.2))),
    requiredObservations,
    stocks,
  };
  return { data, dataAsOf: endDate, freshness: sessionFreshness(endDate, now) };
}
