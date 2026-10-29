import type { z } from "zod";
import type { breadthSchema } from "@/server/schemas/market-intelligence";
import type { MarketStore } from "./store";
import type { Served } from "./market";

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
