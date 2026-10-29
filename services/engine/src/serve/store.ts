// Read port behind the idx-bei /v1 routes. The Drizzle implementation is src/db/market-store.ts; the in-memory one
// backs route and contract tests without a database.

import type { BrokerMemberRecord } from "../db/idx-broker";

export type SecurityRecord = {
  symbol: string; name: string; sector: string | null; subsector: string | null; board: string | null;
  sharesOutstanding: number | null; freeFloatPct: number | null; asOf: Date;
  /** Snapshot capitalisation from the universe sources (IDR), used only when shares are unknown. */
  marketCap?: number | null;
  /** False once the universe sources no longer list the symbol (delisted); absent means active. */
  active?: boolean;
};

/** Normalize Indonesian aliases to the engine's existing public sector label. */
export function normalizeSectorLabel(sector: string | null): string | null {
  if (!sector) return sector;
  return sector.trim().toLocaleLowerCase("id-ID") === "keuangan" ? "Finance" : sector.trim();
}

export type FundamentalRecord = {
  periodEnd: string; periodType: "annual" | "quarterly"; metric: string; value: number; unit: "amount" | "per_share" | "shares";
  currency: string | null; source: string;
};

export type RatioRecord = { symbol: string; ratio: string; ratioSource: "derived" | "idx" | "pasardana"; value: number | null; date: string };

export type DailyRecord = {
  symbol: string; date: string; open: number | null; high: number | null; low: number | null; close: number; previousClose: number | null;
  volume: number | null; value: number | null; frequency: number | null; foreignBuy: number | null; foreignSell: number | null;
};

export type IntradayRecord = {
  symbol: string; ts: Date; last: number | null; open: number | null; high: number | null; low: number | null;
  changePercent: number | null; volume: number | null; value: number | null;
};

export type IndexDailyRecord = { code: string; name: string | null; date: string; close: number; previousClose: number | null; changePercent: number | null };
export type IndexIntradayRecord = { code: string; name: string | null; ts: Date; last: number; changePercent: number | null };
export type BrokerDailySummaryRecord = { date: string; brokerCode: string; firmName: string | null; volume: number | null; value: number | null; frequency: number | null; source: string; asOf: Date };
export type IssuerProfileRecord = { symbol: string; language: string; profile: Record<string, unknown>; directors: Record<string, unknown>[]; commissioners: Record<string, unknown>[]; auditCommittee: Record<string, unknown>[]; shareholders: Record<string, unknown>[]; subsidiaries: Record<string, unknown>[]; retrievedAt: Date;
  /** Row provenance: which source wrote the profile and when it was captured (IDX-BEI: the snapshot's own time). */
  source?: string; asOf?: Date };

export type ActionRecord = { exDate: string | null; type: string; description: string | null; asOf: Date };
export type ActionCalendarRecord = { symbol: string; exDate: string; type: string; source?: string; sourceCategory?: string | null; description: string | null; amount: number | null; ratio: string | null; shares: number | null; sharesAfter: number | null; asOf: Date;
  cumDate?: string | null; recordDate?: string | null; paymentDate?: string | null; noticeId?: string | null; status?: string | null; documentUrl?: string | null };

export type NewsRecord = {
  publishedAt: Date; publishedAtEstimated: boolean; title: string; url: string; outlet: string; summary: string | null; symbols: string[];
};
export type AnnouncementRecord = { externalId: string; symbol: string | null; publishedAt: Date; title: string; documentUrl: string | null };
export type NewsQuery = { offset: number; limit: number; symbol?: string };
export type MacroRecord = { series: string; date: string; value: number; link: string | null };

export interface MarketStore {
  /** Active securities whose symbol starts with, or whose name contains, `query` (all when empty). */
  searchSecurities(query: string, limit: number): Promise<SecurityRecord[]>;
  securities(symbols: string[]): Promise<SecurityRecord[]>;
  /** The newest `limit` daily rows of a symbol, oldest first. */
  dailyHistory(symbol: string, limit: number): Promise<DailyRecord[]>;
  latestIntraday(symbol: string): Promise<IntradayRecord | null>;
  /** Newest session date in daily_prices. */
  latestSessionDate(): Promise<string | null>;
  sessionRows(date: string): Promise<DailyRecord[]>;
  /** The newest `count` session dates in daily_prices up to `endDate` (market-wide), newest first. */
  sessionDates(endDate: string, count: number): Promise<string[]>;
  /** Daily rows of `symbols` with a date in [from, to]. */
  dailyRowsBetween(from: string, to: string, symbols: string[]): Promise<DailyRecord[]>;
  latestSnapshotTs(): Promise<Date | null>;
  snapshotRows(ts: Date): Promise<IntradayRecord[]>;
  /** Close of each symbol's newest session before `date` (previous close for intraday rows). */
  closesBefore(date: string, symbols: string[]): Promise<Map<string, number>>;
  /** Each symbol's newest session on or before `date`, with its close. */
  closesOnOrBefore(date: string, symbols: string[]): Promise<Map<string, { date: string; close: number }>>;
  /** Every daily row in the newest `sessions` session dates up to `endDate` (any symbol, with or without foreign data). */
  sessionHistory(endDate: string, sessions: number): Promise<DailyRecord[]>;
  /** Newest index_daily row per code. */
  latestIndexDaily(): Promise<IndexDailyRecord[]>;
  /** index_daily rows for `codes` (all when null) between `from` and `to` (inclusive), oldest first. */
  indexDailyBetween(codes: string[] | null, from: string, to: string): Promise<IndexDailyRecord[]>;
  /** Market-wide date×broker totals from IDX GetBrokerSummary. */
  brokerDailySummaryBetween(from: string, to: string): Promise<BrokerDailySummaryRecord[]>;
  latestBrokerSummaryDate(): Promise<string | null>;
  brokerDirectory(): Promise<BrokerMemberRecord[]>;
  latestBrokerDirectoryAsOf(): Promise<Date | null>;
  issuerProfile(symbol: string, language?: string): Promise<IssuerProfileRecord | null>;
  /** Newest index_intraday row per code. */
  latestIndexIntraday(): Promise<IndexIntradayRecord[]>;
  /** Newest session date with foreign buy/sell. */
  latestForeignDate(): Promise<string | null>;
  /** Rows with foreign data in the newest `sessions` foreign-flow dates up to `endDate`. */
  foreignHistory(endDate: string, sessions: number): Promise<DailyRecord[]>;
  actions(symbol: string): Promise<ActionRecord[]>;
  /** Corporate actions with an ex-date in [from, to], oldest first (then symbol). */
  actionsBetween(from: string, to: string): Promise<ActionCalendarRecord[]>;
  /** Newest `as_of` in corporate_actions (when the calendar was last refreshed). */
  latestActionAsOf(): Promise<Date | null>;
  /** Headlines newest first (publication time), optionally only those naming `symbol`. */
  news(query: NewsQuery): Promise<NewsRecord[]>;
  /** Newest publication time among stored headlines. */
  latestNewsAt(): Promise<Date | null>;
  announcements(query: NewsQuery): Promise<AnnouncementRecord[]>;
  latestAnnouncementAt(): Promise<Date | null>;
  /** The newest `perSeries` observations of each macro series, newest first. */
  macro(perSeries: number): Promise<MacroRecord[]>;
  /** Every stored statement line of a symbol (any source, any period). */
  fundamentals(symbol: string): Promise<FundamentalRecord[]>;
  /** Stored ratios (every ratio source) of `symbols`. */
  ratios(symbols: string[]): Promise<RatioRecord[]>;
}

const contains = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase());

/** In-memory store with the same semantics as the DB one (tests). */
export class MemoryMarketStore implements MarketStore {
  constructor(readonly data: {
    securities?: SecurityRecord[]; daily?: DailyRecord[]; intraday?: IntradayRecord[];
    indexDaily?: IndexDailyRecord[]; indexIntraday?: IndexIntradayRecord[]; actions?: Array<ActionRecord & { symbol: string; source?: string; sourceCategory?: string | null; amount?: number | null; ratio?: string | null; shares?: number | null; sharesAfter?: number | null }>;
    brokerDaily?: BrokerDailySummaryRecord[];
    brokerMembers?: BrokerMemberRecord[];
    issuerProfiles?: IssuerProfileRecord[];
    news?: NewsRecord[]; announcements?: AnnouncementRecord[]; macro?: MacroRecord[];
    fundamentals?: Array<FundamentalRecord & { symbol: string }>; ratios?: RatioRecord[];
  } = {}) {}

  private get daily() { return this.data.daily ?? []; }

  async searchSecurities(query: string, limit: number) {
    const q = query.trim();
    return (this.data.securities ?? []).filter((row) => !q || row.symbol.startsWith(q.toUpperCase()) || contains(row.name, q))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)).slice(0, limit).map((row) => ({ ...row, sector: normalizeSectorLabel(row.sector) }));
  }
  async securities(symbols: string[]) {
    return (this.data.securities ?? []).filter((row) => symbols.includes(row.symbol)).map((row) => ({ ...row, sector: normalizeSectorLabel(row.sector) }));
  }
  async dailyHistory(symbol: string, limit: number) {
    return this.daily.filter((row) => row.symbol === symbol).sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
  }
  async latestIntraday(symbol: string) {
    return (this.data.intraday ?? []).filter((row) => row.symbol === symbol).sort((a, b) => b.ts.getTime() - a.ts.getTime())[0] ?? null;
  }
  async latestSessionDate() { return this.daily.map((row) => row.date).sort().at(-1) ?? null; }
  async sessionRows(date: string) { return this.daily.filter((row) => row.date === date); }
  async sessionDates(endDate: string, count: number) {
    return [...new Set(this.daily.map((row) => row.date).filter((date) => date <= endDate))].sort().reverse().slice(0, count);
  }
  async dailyRowsBetween(from: string, to: string, symbols: string[]) {
    return this.daily.filter((row) => row.date >= from && row.date <= to && symbols.includes(row.symbol));
  }
  async latestSnapshotTs() { return (this.data.intraday ?? []).map((row) => row.ts).sort((a, b) => b.getTime() - a.getTime())[0] ?? null; }
  async snapshotRows(ts: Date) { return (this.data.intraday ?? []).filter((row) => row.ts.getTime() === ts.getTime()); }
  async closesBefore(date: string, symbols: string[]) {
    const out = new Map<string, number>();
    for (const row of [...this.daily].sort((a, b) => a.date.localeCompare(b.date))) {
      if (row.date < date && symbols.includes(row.symbol)) out.set(row.symbol, row.close);
    }
    return out;
  }
  async closesOnOrBefore(date: string, symbols: string[]) {
    const out = new Map<string, { date: string; close: number }>();
    for (const row of [...this.daily].sort((a, b) => a.date.localeCompare(b.date))) {
      if (row.date <= date && symbols.includes(row.symbol)) out.set(row.symbol, { date: row.date, close: row.close });
    }
    return out;
  }
  async sessionHistory(endDate: string, sessions: number) {
    const dates = [...new Set(this.daily.filter((row) => row.date <= endDate).map((row) => row.date))].sort().slice(-sessions);
    return this.daily.filter((row) => dates.includes(row.date));
  }
  async latestIndexDaily() {
    const latest = new Map<string, IndexDailyRecord>();
    for (const row of this.data.indexDaily ?? []) if (!latest.has(row.code) || latest.get(row.code)!.date < row.date) latest.set(row.code, row);
    return [...latest.values()];
  }
  async latestIndexIntraday() {
    const latest = new Map<string, IndexIntradayRecord>();
    for (const row of this.data.indexIntraday ?? []) if (!latest.has(row.code) || latest.get(row.code)!.ts < row.ts) latest.set(row.code, row);
    return [...latest.values()];
  }
  async indexDailyBetween(codes: string[] | null, from: string, to: string) {
    const set = codes ? new Set(codes) : null;
    return (this.data.indexDaily ?? [])
      .filter((row) => row.date >= from && row.date <= to && (!set || set.has(row.code)))
      .sort((a, b) => a.code.localeCompare(b.code) || a.date.localeCompare(b.date));
  }
  async brokerDailySummaryBetween(from: string, to: string) {
    return (this.data.brokerDaily ?? []).filter((row) => row.date >= from && row.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || (b.value ?? -1) - (a.value ?? -1) || a.brokerCode.localeCompare(b.brokerCode));
  }
  async latestBrokerSummaryDate() { return (this.data.brokerDaily ?? []).map((row) => row.date).sort().at(-1) ?? null; }
  async brokerDirectory() { return (this.data.brokerMembers ?? []).filter((row) => row.active).sort((a, b) => a.code.localeCompare(b.code)); }
  async latestBrokerDirectoryAsOf() { return (this.data.brokerMembers ?? []).map((row) => row.asOf).sort((a, b) => b.getTime() - a.getTime())[0] ?? null; }
  async issuerProfile(symbol: string, language = "id-id") { return (this.data.issuerProfiles ?? []).find((row) => row.symbol === symbol && row.language === language) ?? null; }
  async latestForeignDate() { return this.daily.filter((row) => row.foreignBuy !== null).map((row) => row.date).sort().at(-1) ?? null; }
  async foreignHistory(endDate: string, sessions: number) {
    const dates = [...new Set(this.daily.filter((row) => row.foreignBuy !== null && row.date <= endDate).map((row) => row.date))].sort().slice(-sessions);
    return this.daily.filter((row) => row.foreignBuy !== null && dates.includes(row.date));
  }
  async actions(symbol: string) {
    return (this.data.actions ?? []).filter((row) => row.symbol === symbol).map(({ exDate, type, description, asOf }) => ({ exDate, type, description, asOf }));
  }
  async actionsBetween(from: string, to: string) {
    return (this.data.actions ?? []).filter((row) => row.exDate !== null && row.exDate >= from && row.exDate <= to)
      .sort((a, b) => a.exDate!.localeCompare(b.exDate!) || a.symbol.localeCompare(b.symbol))
      .map((row) => ({ symbol: row.symbol, exDate: row.exDate!, type: row.type, source: row.source, sourceCategory: row.sourceCategory ?? null, description: row.description, amount: row.amount ?? null, ratio: row.ratio ?? null, shares: row.shares ?? null, sharesAfter: row.sharesAfter ?? null, asOf: row.asOf }));
  }
  async latestActionAsOf() { return (this.data.actions ?? []).map((row) => row.asOf).sort((a, b) => b.getTime() - a.getTime())[0] ?? null; }
  async news(query: NewsQuery) {
    return (this.data.news ?? []).filter((row) => !query.symbol || row.symbols.includes(query.symbol))
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(query.offset, query.offset + query.limit);
  }
  async latestNewsAt() { return (this.data.news ?? []).map((row) => row.publishedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null; }
  async announcements(query: NewsQuery) {
    return (this.data.announcements ?? []).filter((row) => !query.symbol || row.symbol === query.symbol)
      .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime()).slice(query.offset, query.offset + query.limit);
  }
  async latestAnnouncementAt() { return (this.data.announcements ?? []).map((row) => row.publishedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null; }
  async fundamentals(symbol: string) {
    return (this.data.fundamentals ?? []).filter((row) => row.symbol === symbol).map(({ symbol: _symbol, ...row }) => row);
  }
  async ratios(symbols: string[]) { return (this.data.ratios ?? []).filter((row) => symbols.includes(row.symbol)); }
  async macro(perSeries: number) {
    const rows = [...(this.data.macro ?? [])].sort((a, b) => a.series.localeCompare(b.series) || b.date.localeCompare(a.date));
    const counts = new Map<string, number>();
    return rows.filter((row) => {
      counts.set(row.series, (counts.get(row.series) ?? 0) + 1);
      return counts.get(row.series)! <= perSeries;
    });
  }
}
