import type { z } from "zod";
import type { breadthHistorySchema, breadthHistoryWindowSchema, breadthSchema } from "@/server/schemas/market-intelligence";
import type { MarketStore } from "./store";
import { sessionFreshness, type Served } from "./market";
import type { DailyRecord } from "./store";

type Breadth = z.input<typeof breadthSchema>;
export async function serveBreadth(store: MarketStore, _now: Date): Promise<Served<Breadth>> {
  const date = await store.latestSessionDate();
  if (!date) return { data: { snapshotDate: null, source: "none", freshness: "UNAVAILABLE", advancers: 0, decliners: 0, unchanged: 0, participation: null, regime: "UNAVAILABLE", sectors: [] }, dataAsOf: null, freshness: "UNAVAILABLE" };
  const rows = await store.sessionRows(date);
  const securities = await store.securities(rows.map((row) => row.symbol));
  const sectorBySymbol = new Map(securities.map((row) => [row.symbol, row.sector ?? "Unknown"]));
  const advancers = rows.filter((r) => (r.close - (r.previousClose ?? r.close)) > 0).length;
  const decliners = rows.filter((r) => (r.close - (r.previousClose ?? r.close)) < 0).length;
  const unchanged = Math.max(0, rows.length - advancers - decliners);
  const participation = rows.length ? (advancers + decliners) / rows.length : null;
  const ratio = rows.length ? (advancers - decliners) / rows.length : 0;
  const regime = !rows.length ? "UNAVAILABLE" : ratio >= 0.2 ? "RISK_ON" : ratio <= -0.2 ? "RISK_OFF" : "MIXED";
  const sectorMap = new Map<string, { sector: string; changePercent: number[]; advancers: number; decliners: number }>();
  for (const row of rows) {
    const sector = sectorBySymbol.get(row.symbol) ?? "Unknown";
    const item = sectorMap.get(sector) ?? { sector, changePercent: [], advancers: 0, decliners: 0 };
    const change = row.previousClose ? row.close / row.previousClose - 1 : null;
    if (change !== null) item.changePercent.push(change);
    if (change && change > 0) item.advancers += 1;
    if (change && change < 0) item.decliners += 1;
    sectorMap.set(sector, item);
  }
  const sectors = [...sectorMap.values()].map((item) => ({ sector: item.sector, changePercent: item.changePercent.length ? item.changePercent.reduce((sum, value) => sum + value, 0) / item.changePercent.length : null, advancers: item.advancers, decliners: item.decliners })).sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity));
  return { data: { snapshotDate: date, source: "daily_prices", freshness: "EOD", advancers, decliners, unchanged, participation, regime, sectors }, dataAsOf: date, freshness: "EOD" };
}

type BreadthHistory = z.input<typeof breadthHistorySchema>;
type BreadthWindow = z.input<typeof breadthHistoryWindowSchema>;
const DISPLAY_SESSIONS: Record<BreadthWindow, number> = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252 };
const SMA_SESSIONS = 20;

/** Build an ascending, bounded breadth series from stored EOD rows. No missing close/value is fabricated. */
export async function serveBreadthHistory(store: MarketStore, window: BreadthWindow, now: Date): Promise<Served<BreadthHistory>> {
  const displayed = DISPLAY_SESSIONS[window];
  const empty: BreadthHistory = { window, snapshotDate: null, source: "none", freshness: "UNAVAILABLE", series: [] };
  const latestDate = await store.latestSessionDate();
  if (!latestDate) return { data: empty, dataAsOf: null, freshness: "UNAVAILABLE" };

  const rows = await store.sessionHistory(latestDate, displayed + SMA_SESSIONS - 1);
  if (!rows.length) return { data: empty, dataAsOf: null, freshness: "UNAVAILABLE" };

  const sessions = new Map<string, Map<string, DailyRecord>>();
  for (const row of rows) {
    const bySymbol = sessions.get(row.date) ?? new Map<string, DailyRecord>();
    bySymbol.set(row.symbol, row);
    sessions.set(row.date, bySymbol);
  }
  const orderedDates = [...sessions.keys()].sort();
  const displayFrom = Math.max(0, orderedDates.length - displayed);
  const lastClose = new Map<string, number>();
  const closeWindow = new Map<string, number[]>();
  const result: BreadthHistory["series"] = [];
  let cumulativePressure = 0;
  let pressureReady = false;

  for (const date of orderedDates) {
    const dayRows = [...sessions.get(date)!.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
    let advancers = 0;
    let decliners = 0;
    let unchanged = 0;
    let comparable = 0;
    let aboveSma20 = 0;
    let aboveSma20Eligible = 0;
    let advancingValueIdr = 0;
    let decliningValueIdr = 0;
    let valueObserved = 0;

    for (const row of dayRows) {
      const previous = row.previousClose !== null && Number.isFinite(row.previousClose) && row.previousClose > 0
        ? row.previousClose
        : lastClose.get(row.symbol) ?? null;
      const direction = previous === null ? null : row.close > previous ? 1 : row.close < previous ? -1 : 0;
      if (direction !== null) {
        comparable += 1;
        if (direction > 0) advancers += 1;
        else if (direction < 0) decliners += 1;
        else unchanged += 1;
      }
      if (row.value !== null && Number.isFinite(row.value) && row.value >= 0) {
        valueObserved += 1;
        if (direction === 1) advancingValueIdr += row.value;
        if (direction === -1) decliningValueIdr += row.value;
      }

      const values = closeWindow.get(row.symbol) ?? [];
      if (Number.isFinite(row.close) && row.close > 0) {
        values.push(row.close);
        if (values.length > SMA_SESSIONS) values.shift();
        closeWindow.set(row.symbol, values);
        if (values.length === SMA_SESSIONS) {
          aboveSma20Eligible += 1;
          const average = values.reduce((sum, value) => sum + value, 0) / SMA_SESSIONS;
          if (row.close > average) aboveSma20 += 1;
        }
        lastClose.set(row.symbol, row.close);
      }
    }

    const netAdvanceRate = comparable ? (advancers - decliners) / comparable : null;
    if (date >= orderedDates[displayFrom] && netAdvanceRate !== null) {
      cumulativePressure += netAdvanceRate * 100;
      pressureReady = true;
    }
    if (date < orderedDates[displayFrom]) continue;
    const observed = dayRows.length;
    const directionalValue = advancingValueIdr + decliningValueIdr;
    result.push({
      date, advancers, decliners, unchanged, comparable, observed,
      coverage: observed ? comparable / observed : null,
      netAdvanceRate,
      cumulativePressure: netAdvanceRate !== null && pressureReady ? cumulativePressure : null,
      aboveSma20Pct: aboveSma20Eligible ? aboveSma20 / aboveSma20Eligible : null,
      aboveSma20Eligible,
      advancingValueIdr, decliningValueIdr, valueObserved,
      valueCoverage: observed ? valueObserved / observed : null,
      advancingValueShare: directionalValue > 0 ? advancingValueIdr / directionalValue : null,
    });
  }

  const snapshotDate = orderedDates.at(-1) ?? latestDate;
  const freshness = sessionFreshness(snapshotDate, now);
  return {
    data: { window, snapshotDate, source: "daily_prices", freshness, series: result },
    dataAsOf: snapshotDate,
    freshness,
  };
}
