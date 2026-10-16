// Read port behind the idx-bei /v1 routes. The Drizzle implementation is src/db/market-store.ts; the in-memory one
// backs route and contract tests without a database.

export type SecurityRecord = {
  symbol: string; name: string; sector: string | null; subsector: string | null; board: string | null;
  sharesOutstanding: number | null; freeFloatPct: number | null; asOf: Date;
};

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

export type ActionRecord = { exDate: string | null; type: string; description: string | null; asOf: Date };

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
  latestSnapshotTs(): Promise<Date | null>;
  snapshotRows(ts: Date): Promise<IntradayRecord[]>;
  /** Close of each symbol's newest session before `date` (previous close for intraday rows). */
  closesBefore(date: string, symbols: string[]): Promise<Map<string, number>>;
  /** Newest index_daily row per code. */
  latestIndexDaily(): Promise<IndexDailyRecord[]>;
  /** Newest index_intraday row per code. */
  latestIndexIntraday(): Promise<IndexIntradayRecord[]>;
  /** Newest session date with foreign buy/sell. */
  latestForeignDate(): Promise<string | null>;
  /** Rows with foreign data in the newest `sessions` foreign-flow dates up to `endDate`. */
  foreignHistory(endDate: string, sessions: number): Promise<DailyRecord[]>;
  actions(symbol: string): Promise<ActionRecord[]>;
}

const contains = (haystack: string, needle: string) => haystack.toLowerCase().includes(needle.toLowerCase());

/** In-memory store with the same semantics as the DB one (tests). */
export class MemoryMarketStore implements MarketStore {
  constructor(readonly data: {
    securities?: SecurityRecord[]; daily?: DailyRecord[]; intraday?: IntradayRecord[];
    indexDaily?: IndexDailyRecord[]; indexIntraday?: IndexIntradayRecord[]; actions?: Array<ActionRecord & { symbol: string }>;
  } = {}) {}

  private get daily() { return this.data.daily ?? []; }

  async searchSecurities(query: string, limit: number) {
    const q = query.trim();
    return (this.data.securities ?? []).filter((row) => !q || row.symbol.startsWith(q.toUpperCase()) || contains(row.name, q))
      .sort((a, b) => a.symbol.localeCompare(b.symbol)).slice(0, limit);
  }
  async securities(symbols: string[]) { return (this.data.securities ?? []).filter((row) => symbols.includes(row.symbol)); }
  async dailyHistory(symbol: string, limit: number) {
    return this.daily.filter((row) => row.symbol === symbol).sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
  }
  async latestIntraday(symbol: string) {
    return (this.data.intraday ?? []).filter((row) => row.symbol === symbol).sort((a, b) => b.ts.getTime() - a.ts.getTime())[0] ?? null;
  }
  async latestSessionDate() { return this.daily.map((row) => row.date).sort().at(-1) ?? null; }
  async sessionRows(date: string) { return this.daily.filter((row) => row.date === date); }
  async latestSnapshotTs() { return (this.data.intraday ?? []).map((row) => row.ts).sort((a, b) => b.getTime() - a.getTime())[0] ?? null; }
  async snapshotRows(ts: Date) { return (this.data.intraday ?? []).filter((row) => row.ts.getTime() === ts.getTime()); }
  async closesBefore(date: string, symbols: string[]) {
    const out = new Map<string, number>();
    for (const row of [...this.daily].sort((a, b) => a.date.localeCompare(b.date))) {
      if (row.date < date && symbols.includes(row.symbol)) out.set(row.symbol, row.close);
    }
    return out;
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
  async latestForeignDate() { return this.daily.filter((row) => row.foreignBuy !== null).map((row) => row.date).sort().at(-1) ?? null; }
  async foreignHistory(endDate: string, sessions: number) {
    const dates = [...new Set(this.daily.filter((row) => row.foreignBuy !== null && row.date <= endDate).map((row) => row.date))].sort().slice(-sessions);
    return this.daily.filter((row) => row.foreignBuy !== null && dates.includes(row.date));
  }
  async actions(symbol: string) {
    return (this.data.actions ?? []).filter((row) => row.symbol === symbol).map(({ exDate, type, description, asOf }) => ({ exDate, type, description, asOf }));
  }
}

