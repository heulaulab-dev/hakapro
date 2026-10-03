/**
 * "What should I know about this stock?" — descriptive facts derived from provider data.
 * Pure functions: they return numbers and keys, never advice or prose (the UI localizes them).
 */
import type { BrokerSummary, FinancialStatements, History, Insiders } from "./arjum-normalize";
import { calculateSimpleMovingAverage } from "@/lib/indicators";

export type PriceFacts = {
  date: string;
  close: number;
  change: number;
  changePercent: number;
  /** Sessions actually covered by the range figures (≤ requested). */
  rangeSessions: number;
  rangeChangePercent: number | null;
  rangeHigh: number;
  rangeLow: number;
  sma20: number | null;
  closeVsSma20: "above" | "below" | "at" | null;
};

export function summarizePrice(history: History, rangeSessions = 63): PriceFacts | null {
  const rows = history.rows;
  const latest = rows.at(-1);
  if (!latest) return null;
  const range = rows.slice(-rangeSessions);
  const first = range[0];
  const sma = calculateSimpleMovingAverage(rows.map((row) => ({ time: row.date, close: row.close })), 20).at(-1);
  const sma20 = sma && sma.time === latest.date ? sma.value : null;
  return {
    date: latest.date,
    close: latest.close,
    change: latest.change,
    changePercent: latest.changePercent,
    rangeSessions: range.length,
    rangeChangePercent: first && first.close ? ((latest.close - first.close) / first.close) * 100 : null,
    rangeHigh: Math.max(...range.map((row) => row.high)),
    rangeLow: Math.min(...range.map((row) => row.low)),
    sma20,
    closeVsSma20: sma20 === null ? null : latest.close > sma20 ? "above" : latest.close < sma20 ? "below" : "at",
  };
}

export type BrokerNet = { code: string; netValueIdr: number };
export type FlowFacts = {
  /** Foreign flow over the most recent sessions (from daily history). */
  foreign: { sessions: number; netBuySessions: number; netSellSessions: number; netShares: number; netShares20: number | null; latestDate: string } | null;
  /** Broker activity for the broker-summary date range. */
  brokers: { startDate: string; endDate: string; topBuyers: BrokerNet[]; topSellers: BrokerNet[] } | null;
};

export function summarizeForeignFlow(history: History, sessions = 5): FlowFacts["foreign"] {
  const rows = history.rows;
  if (!rows.length) return null;
  const recent = rows.slice(-sessions);
  const last20 = rows.slice(-20);
  return {
    sessions: recent.length,
    netBuySessions: recent.filter((row) => row.foreignNetShares > 0).length,
    netSellSessions: recent.filter((row) => row.foreignNetShares < 0).length,
    netShares: recent.reduce((sum, row) => sum + row.foreignNetShares, 0),
    netShares20: last20.length === 20 ? last20.reduce((sum, row) => sum + row.foreignNetShares, 0) : null,
    latestDate: rows.at(-1)!.date,
  };
}

export function summarizeBrokers(summary: BrokerSummary, top = 3): FlowFacts["brokers"] {
  if (!summary.brokers.length) return null;
  const byNet = [...summary.brokers].sort((a, b) => b.netValueIdr - a.netValueIdr);
  const pick = (row: { code: string; netValueIdr: number }) => ({ code: row.code, netValueIdr: row.netValueIdr });
  return {
    startDate: summary.startDate,
    endDate: summary.endDate,
    topBuyers: byNet.filter((row) => row.netValueIdr > 0).slice(0, top).map(pick),
    // Only brokers that actually sold net; an all-buyers list yields none rather than "smallest buyers".
    topSellers: byNet.filter((row) => row.netValueIdr < 0).reverse().slice(0, top).map(pick),
  };
}

export type OwnershipFacts = {
  transactions: number;
  buys: number;
  sells: number;
  /** Sum of parsed share changes; null if any change was unparseable. */
  netChangeShares: number | null;
  latestDate: string | null;
  totalReported: number;
};

export function summarizeInsiders(insiders: Insiders): OwnershipFacts {
  const rows = insiders.rows;
  const changes = rows.map((row) => (row.action === "SELL" && row.changeShares !== null ? -Math.abs(row.changeShares) : row.changeShares));
  return {
    transactions: rows.length,
    buys: rows.filter((row) => row.action === "BUY").length,
    sells: rows.filter((row) => row.action === "SELL").length,
    netChangeShares: changes.some((change) => change === null) ? null : (changes as number[]).reduce((sum, change) => sum + change, 0),
    latestDate: rows.map((row) => row.date).sort().at(-1) ?? null,
    totalReported: insiders.total,
  };
}

export type FinancialFacts = {
  reportType: string;
  latestPeriod: string | null;
  latestPeriodEnd: string | null;
  expectedPeriodEnd: string;
  behind: boolean;
  periods: number;
};

export function summarizeFinancials(statements: FinancialStatements): FinancialFacts {
  const latest = statements.periods.find((period) => period.periodEnd === statements.reportingLag.latestPeriodEnd);
  return {
    reportType: statements.reportType,
    latestPeriod: latest?.label ?? null,
    latestPeriodEnd: statements.reportingLag.latestPeriodEnd,
    expectedPeriodEnd: statements.reportingLag.expectedPeriodEnd,
    behind: statements.reportingLag.behind,
    periods: statements.periods.length,
  };
}
