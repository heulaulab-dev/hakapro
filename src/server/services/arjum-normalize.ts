/**
 * Provider → domain mapping for the arjum lane. Ported from heulatrade
 * lib/market/arjum/normalizers.ts and lib/market/arjum/server.ts.
 *
 * Unit conventions (verified against fixtures/arjum):
 *   volumes and foreign flow are shares; done-details quantity is lots (1 lot = 100 shares);
 *   values and prices are IDR; `changePercent` is in percent units (-0.79 = -0.79%).
 */
import type {
  BrokerAccumulationResponse, BrokerSummaryResponse, DoneDetailsResponse, FinancialStatementsResponse,
  HistoryResponse, InsidersResponse, MarketCapResponse, SearchResponse, SeasonalityResponse,
} from "@/server/schemas/arjum";
import { expectedLatestPeriodEnd, periodEnd } from "@/server/config/reporting";
import { parseProviderNumber, type ParseOptions } from "./parse-number";

export type NumberIssue = { field: string; input: string; reason: string };

export type SearchResult = { symbol: string; companyName: string; lastDate: string };
export function normalizeSearch(value: SearchResponse): SearchResult[] {
  return value.map((row) => ({ symbol: row.stock_code, companyName: row.stock_name, lastDate: row.last_date }));
}

export type BrokerRow = {
  code: string; name: string;
  buyValueIdr: number; sellValueIdr: number; netValueIdr: number;
  buyVolumeShares: number; sellVolumeShares: number; netVolumeShares: number;
  buyFrequency: number; sellFrequency: number; netFrequency: number;
};
export type BrokerSummary = { symbol: string; startDate: string; endDate: string; brokers: BrokerRow[] };
export function normalizeBrokerSummary(value: BrokerSummaryResponse): BrokerSummary {
  return {
    symbol: value.stock_code, startDate: value.broker_start_date, endDate: value.broker_end_date,
    brokers: value.brokers.map((row) => ({
      code: row.broker_code, name: row.broker_name,
      buyValueIdr: row.bval, sellValueIdr: row.sval, netValueIdr: row.nval,
      buyVolumeShares: row.bvol, sellVolumeShares: row.svol, netVolumeShares: row.nvol,
      buyFrequency: row.bfrq, sellFrequency: row.sfrq, netFrequency: row.bfrq - row.sfrq,
    })).sort((a, b) => b.netValueIdr - a.netValueIdr),
  };
}

export type BrokerAccumulation = {
  symbol: string; startDate: string; endDate: string;
  series: Array<{ code: string; name: string; points: Array<{ date: string; netValueIdr: number; netVolumeShares: number; cumulativeNetValueIdr: number; buyAverageIdr: number | null; sellAverageIdr: number | null }> }>;
  topBuyers: Array<{ code: string; name: string; totalNetValueIdr: number }>;
  topSellers: Array<{ code: string; name: string; totalNetValueIdr: number }>;
};
export function normalizeBrokerAccumulation(value: BrokerAccumulationResponse): BrokerAccumulation {
  const total = (row: { broker_code: string; broker_name: string; total_nval: number }) => ({ code: row.broker_code, name: row.broker_name, totalNetValueIdr: row.total_nval });
  return {
    symbol: value.code, startDate: value.start_date, endDate: value.end_date,
    series: value.series.map((series) => ({
      code: series.broker_code, name: series.broker_name,
      points: series.points.map((point) => ({ date: point.date, netValueIdr: point.nval, netVolumeShares: point.nvol, cumulativeNetValueIdr: point.cum_nval, buyAverageIdr: point.bavg, sellAverageIdr: point.savg })),
    })),
    topBuyers: value.top_buyers.map(total),
    topSellers: value.top_sellers.map(total),
  };
}

export type HistoryRow = {
  date: string; open: number; high: number; low: number; close: number; averageIdr: number | null;
  change: number; changePercent: number; valueIdr: number; volumeShares: number; frequency: number;
  foreignBuyShares: number; foreignSellShares: number; foreignNetShares: number;
};
export type History = { symbol: string; frame: string; rows: HistoryRow[] };
/** Rows are returned newest first by the provider; output is sorted ascending for charts. */
export function normalizeHistory(value: HistoryResponse): History {
  return {
    symbol: value.stock_code, frame: value.frame,
    rows: value.rows.map((row) => ({
      date: row.date, open: row.open, high: row.high, low: row.low, close: row.close, averageIdr: row.avg,
      change: row.change, changePercent: row.change_pct, valueIdr: row.value, volumeShares: row.volume, frequency: row.freq,
      foreignBuyShares: row.f_buy, foreignSellShares: row.f_sell, foreignNetShares: row.n_foreign,
    })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export type Seasonality = {
  symbol: string; months: string[];
  /** First and last year-month (YYYY-MM) that have a return value. */
  coverage: { from: string; to: string } | null;
  rows: Array<{ year: string; averagePercent: number | null; valuesPercent: Array<number | null> }>;
  summary: Array<{ month: string; averagePercent: number | null; upProbability: number | null; samples: number }>;
};
// Units verified against the recorded sample: monthly returns, yearly averages and up_prob are percent units.
export function normalizeSeasonality(value: SeasonalityResponse): Seasonality {
  const covered = value.years.flatMap((year) => MONTHS.map((month, index) => (value.monthly_returns[month]?.[year] === undefined ? null : `${year}-${String(index + 1).padStart(2, "0")}`)))
    .filter((key): key is string => key !== null).sort();
  return {
    symbol: value.stock_code, months: [...MONTHS],
    coverage: covered.length ? { from: covered[0], to: covered.at(-1)! } : null,
    rows: value.years.map((year) => ({ year, averagePercent: value.yearly_avg[year] ?? null, valuesPercent: MONTHS.map((month) => value.monthly_returns[month]?.[year] ?? null) })),
    summary: MONTHS.map((month) => ({ month, averagePercent: value.summary[month]?.avg ?? null, upProbability: value.summary[month]?.up_prob ?? null, samples: value.summary[month]?.total ?? 0 })),
  };
}

export type MarketCapRow = { symbol: string; name: string; closeIdr: number; marketCapIdr: number; listedShares: number; turnoverRatio: number };
export type MarketCap = { date: string; total: number; page: number; perPage: number; totalPages: number; rows: MarketCapRow[] };
/** Uses the numeric fields only; `*_label` strings are ignored (see parse-number tests for why). */
export function normalizeMarketCap(value: MarketCapResponse): MarketCap {
  return {
    date: value.date, total: value.total, page: value.page, perPage: value.per_page, totalPages: value.total_pages,
    rows: value.data.map((row) => ({ symbol: row.code, name: row.name, closeIdr: row.close, marketCapIdr: row.market_cap, listedShares: row.listed_shares, turnoverRatio: row.turnover_ratio })),
  };
}

export type FinancialRow = { key: string; label: string; depth: number; expandable: boolean; values: Array<number | null> };
export type FinancialPeriod = {
  year: string; quarter: string; label: string;
  /** Last day of the reporting period (YYYY-MM-DD); null when the provider period is unreadable. */
  periodEnd: string | null;
  /** Filing/publication date. The provider does not supply it yet. */
  filingDate: string | null;
  /** When the provider scraped the report — not the data date. */
  fetchedAt: string;
};
export type FinancialStatements = {
  symbol: string; reportType: string; period: string;
  periods: FinancialPeriod[];
  rows: FinancialRow[];
  /** Whether the newest available period is older than what should be public by now. */
  reportingLag: { latestPeriodEnd: string | null; expectedPeriodEnd: string; behind: boolean };
};
function labelFor(key: string): string {
  return key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
export function buildFinancialRows(items: FinancialStatementsResponse["items"]): FinancialRow[] {
  const paths = new Map<string, { key: string; depth: number; expandable: boolean }>();
  function visit(value: unknown, path: string[], depth: number) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      const next = [...path, key];
      const expandable = Boolean(child && typeof child === "object");
      paths.set(next.join("."), { key, depth, expandable });
      if (expandable) visit(child, next, depth + 1);
    }
  }
  for (const item of items) visit(item.data, [], 0);
  return [...paths].map(([path, definition]) => ({
    key: path, label: labelFor(definition.key), depth: definition.depth, expandable: definition.expandable,
    values: items.map((item) => {
      let value: unknown = item.data;
      for (const segment of path.split(".")) value = value && typeof value === "object" ? (value as Record<string, unknown>)[segment] : null;
      return typeof value === "number" ? value : null;
    }),
  }));
}
export function normalizeFinancialStatements(value: FinancialStatementsResponse, today: string): FinancialStatements {
  const periods = value.items.map((item) => ({
    year: item.year, quarter: item.quarter, label: item.label,
    periodEnd: periodEnd(item.year, item.quarter, value.period), filingDate: null, fetchedAt: item.fetched_at,
  }));
  const latestPeriodEnd = periods.map((period) => period.periodEnd).filter((end): end is string => end !== null).sort().at(-1) ?? null;
  const expectedPeriodEnd = expectedLatestPeriodEnd(today, value.period);
  return {
    symbol: value.stock_code, reportType: value.report_type, period: value.period, periods,
    rows: buildFinancialRows(value.items),
    reportingLag: { latestPeriodEnd, expectedPeriodEnd, behind: latestPeriodEnd === null || latestPeriodEnd < expectedPeriodEnd },
  };
}

export type InsiderRow = {
  person: string; date: string; action: "BUY" | "SELL" | "CROSS" | "OTHER"; nationality: string; roles: string[]; broker: string | null;
  previousShares: number | null; currentShares: number | null; changeShares: number | null;
  /** Percent of listed shares, in percent units (0.0061 = 0.0061%). */
  previousPercent: number | null; currentPercent: number | null; changePercent: number | null;
  priceIdr: number | null;
};
export type Insiders = { symbol: string; total: number; page: number; pageSize: number; totalPages: number; rows: InsiderRow[] };

const SHARES: ParseOptions = { unit: "shares", separators: "en" };
const PERCENT: ParseOptions = { unit: "percent", separators: "en" };
const IDR: ParseOptions = { unit: "idr", separators: "en" };

export function normalizeInsiders(value: InsidersResponse): { data: Insiders; issues: NumberIssue[] } {
  const issues: NumberIssue[] = [];
  const parse = (field: string, input: string, options: ParseOptions) => {
    if (!input.trim()) return null;
    const result = parseProviderNumber(input, options);
    if (result.ok) return result.quantity.value;
    issues.push({ field, input, reason: result.reason });
    return null;
  };
  const action = (raw: string): InsiderRow["action"] => {
    const upper = raw.toUpperCase();
    return upper === "BUY" || upper === "SELL" || upper === "CROSS" ? upper : "OTHER";
  };
  return {
    data: {
      symbol: value.stock_code, total: value.total, page: value.page, pageSize: value.page_size, totalPages: value.total_pages,
      rows: value.items.map((row) => ({
        person: row.name, date: row.date, action: action(row.action_type), nationality: row.nationality, roles: row.badges, broker: row.broker_code || null,
        previousShares: parse("insiders.previous_value", row.previous_value, SHARES),
        currentShares: parse("insiders.current_value", row.current_value, SHARES),
        changeShares: parse("insiders.changes_value", row.changes_value, SHARES),
        previousPercent: parse("insiders.previous_percentage", row.previous_percentage, PERCENT),
        currentPercent: parse("insiders.current_percentage", row.current_percentage, PERCENT),
        changePercent: parse("insiders.changes_percentage", row.changes_percentage, PERCENT),
        priceIdr: parse("insiders.price_formatted", row.price_formatted, IDR),
      })),
    },
    issues,
  };
}

export type DoneDetailRow = { time: string; board: string; priceIdr: number; lots: number; valueIdr: number; buyer: string; seller: string; buyerType: string; sellerType: string; aggressor: string };
export type DoneDetails = { symbol: string; date: string; total: number; page: number; perPage: number; totalPages: number; rows: DoneDetailRow[] };
/** Uses `price_num`/`qty_num`/`value_raw`; the formatted `price`/`lot` strings are ignored. Odd lots (<100 shares) report 0 lots. */
export function normalizeDoneDetails(value: DoneDetailsResponse): DoneDetails {
  return {
    symbol: value.code, date: value.date, total: value.total, page: value.page, perPage: value.per_page, totalPages: value.total_pages,
    rows: value.data.map((row) => ({ time: row.time, board: row.market_board, priceIdr: row.price_num, lots: row.qty_num, valueIdr: row.value_raw, buyer: row.buyer, seller: row.seller, buyerType: row.buyer_type, sellerType: row.seller_type, aggressor: row.action })),
  };
}

/** Broker ranking extracted from heulatrade components/panels/provider-panels.tsx:63. */
export type BrokerRankMode = "VALUE" | "VOLUME" | "FREQUENCY";
export function rankBrokers(rows: BrokerRow[], mode: BrokerRankMode): BrokerRow[] {
  const key = mode === "VOLUME" ? "netVolumeShares" : mode === "FREQUENCY" ? "netFrequency" : "netValueIdr";
  return [...rows].sort((a, b) => b[key] - a[key]);
}
