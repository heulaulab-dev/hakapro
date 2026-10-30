import type { MarketStore, DailyRecord } from "./store";
import { sessionFreshness, type Served } from "./market";

type PulseSector = { sector: string; priced: number; observed: number; netShares: number; netValueIdrEstimate: number };
type PulseHistoryPoint = { date: string; priced: number; observed: number };
export type ForeignFlowPulse = {
  date: string;
  coverage: { priced: number; observed: number; ratio: number };
  totals: { netBuyers: number; netSellers: number; unchanged: number; netShares: number; netValueIdrEstimate: number };
  sectors: PulseSector[];
  history: PulseHistoryPoint[];
};

const netOf = (row: DailyRecord) => row.foreignBuy === null || row.foreignSell === null ? null : row.foreignBuy - row.foreignSell;

/**
 * Summarizes the latest stored foreign-flow session across active listed securities.
 * Net value is an estimate: observed net shares multiplied by the same-session close.
 */
export async function serveForeignFlowPulse(store: MarketStore, now: Date): Promise<Served<ForeignFlowPulse> | null> {
  const date = await store.latestForeignDate();
  if (!date) return null;

  const rows = await store.sessionHistory(date, 5);
  const securities = await store.securities([...new Set(rows.map((row) => row.symbol))]);
  const securityBySymbol = new Map(securities.map((security) => [security.symbol, security]));
  const activeRows = rows.filter((row) => securityBySymbol.has(row.symbol) && securityBySymbol.get(row.symbol)?.active !== false);
  const session = activeRows.filter((row) => row.date === date && Number.isFinite(row.close) && row.close > 0);
  const observedRows = session.filter((row) => netOf(row) !== null);
  const observedNet = observedRows.map((row) => netOf(row)!);
  const netShares = observedNet.reduce((sum, value) => sum + value, 0);
  const netValueIdrEstimate = observedRows.reduce((sum, row) => sum + netOf(row)! * row.close, 0);

  const sectorMap = new Map<string, { priced: number; observed: number; netShares: number; netValueIdrEstimate: number }>();
  for (const row of session) {
    const sector = securityBySymbol.get(row.symbol)?.sector?.trim() || "Unknown";
    const summary = sectorMap.get(sector) ?? { priced: 0, observed: 0, netShares: 0, netValueIdrEstimate: 0 };
    summary.priced += 1;
    const net = netOf(row);
    if (net !== null) {
      summary.observed += 1;
      summary.netShares += net;
      summary.netValueIdrEstimate += net * row.close;
    }
    sectorMap.set(sector, summary);
  }

  const historyMap = new Map<string, { priced: number; observed: number }>();
  for (const row of activeRows) {
    if (!Number.isFinite(row.close) || row.close <= 0) continue;
    const point = historyMap.get(row.date) ?? { priced: 0, observed: 0 };
    point.priced += 1;
    if (netOf(row) !== null) point.observed += 1;
    historyMap.set(row.date, point);
  }

  const priced = session.length;
  const observed = observedRows.length;
  const data: ForeignFlowPulse = {
    date,
    coverage: { priced, observed, ratio: priced ? observed / priced : 0 },
    totals: {
      netBuyers: observedNet.filter((value) => value > 0).length,
      netSellers: observedNet.filter((value) => value < 0).length,
      unchanged: observedNet.filter((value) => value === 0).length,
      netShares,
      netValueIdrEstimate,
    },
    sectors: [...sectorMap.entries()].map(([sector, summary]) => ({ sector, ...summary }))
      .sort((a, b) => Math.abs(b.netValueIdrEstimate) - Math.abs(a.netValueIdrEstimate) || a.sector.localeCompare(b.sector)),
    history: [...historyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, point]) => ({ date, ...point })),
  };
  return { data, dataAsOf: date, freshness: sessionFreshness(date, now) };
}
