// Drizzle implementation of the /v1 read port (src/serve/store.ts).
import { and, arrayContains, asc, desc, eq, gte, ilike, inArray, isNotNull, like, lt, lte, max, or, sql } from "drizzle-orm";
import * as t from "../../db/schema";
import type {
  ActionCalendarRecord, ActionRecord, DailyRecord, FundamentalRecord, IndexDailyRecord, IndexIntradayRecord, IntradayRecord, MacroRecord, MarketStore, NewsQuery, NewsRecord,
  RatioRecord, SecurityRecord,
} from "../serve/store";
import { normalizeSectorLabel } from "../serve/store";
import { brokerDailyBetween, idxBrokerMembers, latestIdxBrokerMembersAsOf, latestBrokerSummaryDate } from "./idx-broker";
import { getIdxIssuerProfile } from "./idx-issuer";
import type { EngineDb } from "./client";

const dailyColumns = {
  symbol: t.dailyPrices.symbol, date: t.dailyPrices.date, open: t.dailyPrices.open, high: t.dailyPrices.high, low: t.dailyPrices.low,
  close: t.dailyPrices.close, previousClose: t.dailyPrices.previousClose, volume: t.dailyPrices.volume, value: t.dailyPrices.value,
  frequency: t.dailyPrices.frequency, foreignBuy: t.dailyPrices.foreignBuy, foreignSell: t.dailyPrices.foreignSell,
};
const intradayColumns = {
  symbol: t.intradaySnapshots.symbol, ts: t.intradaySnapshots.ts, last: t.intradaySnapshots.last, open: t.intradaySnapshots.open,
  high: t.intradaySnapshots.high, low: t.intradaySnapshots.low, changePercent: t.intradaySnapshots.changePercent,
  volume: t.intradaySnapshots.volume, value: t.intradaySnapshots.value,
};
const securityColumns = {
  symbol: t.securities.symbol, name: t.securities.name, sector: t.securities.sector, subsector: t.securities.subsector, board: t.securities.board,
  sharesOutstanding: t.securities.sharesOutstanding, freeFloatPct: t.securities.freeFloatPct, asOf: t.securities.asOf,
  marketCap: t.securities.marketCap, active: t.securities.active,
};
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => `\\${char}`);

export class DbMarketStore implements MarketStore {
  constructor(private readonly db: EngineDb) {}

  async searchSecurities(query: string, limit: number): Promise<SecurityRecord[]> {
    const q = query.trim();
    const match = q ? or(like(t.securities.symbol, `${escapeLike(q.toUpperCase())}%`), ilike(t.securities.name, `%${escapeLike(q)}%`)) : undefined;
    const rows = await this.db.select(securityColumns).from(t.securities).where(and(eq(t.securities.active, true), match)).orderBy(asc(t.securities.symbol)).limit(limit);
    return rows.map((row) => ({ ...row, sector: normalizeSectorLabel(row.sector) }));
  }

  async securities(symbols: string[]): Promise<SecurityRecord[]> {
    if (!symbols.length) return [];
    const rows = await this.db.select(securityColumns).from(t.securities).where(inArray(t.securities.symbol, symbols));
    return rows.map((row) => ({ ...row, sector: normalizeSectorLabel(row.sector) }));
  }

  async dailyHistory(symbol: string, limit: number): Promise<DailyRecord[]> {
    const rows = await this.db.select(dailyColumns).from(t.dailyPrices).where(eq(t.dailyPrices.symbol, symbol)).orderBy(desc(t.dailyPrices.date)).limit(limit);
    return rows.reverse();
  }

  async latestIntraday(symbol: string): Promise<IntradayRecord | null> {
    const [row] = await this.db.select(intradayColumns).from(t.intradaySnapshots).where(eq(t.intradaySnapshots.symbol, symbol)).orderBy(desc(t.intradaySnapshots.ts)).limit(1);
    return row ?? null;
  }

  async latestSessionDate(): Promise<string | null> {
    const [row] = await this.db.select({ date: max(t.dailyPrices.date) }).from(t.dailyPrices);
    return row?.date ?? null;
  }

  async sessionRows(date: string): Promise<DailyRecord[]> {
    return this.db.select(dailyColumns).from(t.dailyPrices).where(eq(t.dailyPrices.date, date));
  }

  async sessionDates(endDate: string, count: number): Promise<string[]> {
    const rows = await this.db.selectDistinct({ date: t.dailyPrices.date }).from(t.dailyPrices)
      .where(lte(t.dailyPrices.date, endDate)).orderBy(desc(t.dailyPrices.date)).limit(count);
    return rows.map((row) => row.date);
  }

  async dailyRowsBetween(from: string, to: string, symbols: string[]): Promise<DailyRecord[]> {
    if (!symbols.length) return [];
    return this.db.select(dailyColumns).from(t.dailyPrices)
      .where(and(inArray(t.dailyPrices.symbol, symbols), gte(t.dailyPrices.date, from), lte(t.dailyPrices.date, to)));
  }

  async latestSnapshotTs(): Promise<Date | null> {
    const [row] = await this.db.select({ ts: max(t.intradaySnapshots.ts) }).from(t.intradaySnapshots);
    return row?.ts ?? null;
  }

  async snapshotRows(ts: Date): Promise<IntradayRecord[]> {
    return this.db.select(intradayColumns).from(t.intradaySnapshots).where(eq(t.intradaySnapshots.ts, ts));
  }

  async closesBefore(date: string, symbols: string[]): Promise<Map<string, number>> {
    if (!symbols.length) return new Map();
    const rows = await this.db.selectDistinctOn([t.dailyPrices.symbol], { symbol: t.dailyPrices.symbol, close: t.dailyPrices.close })
      .from(t.dailyPrices).where(and(inArray(t.dailyPrices.symbol, symbols), lt(t.dailyPrices.date, date)))
      .orderBy(t.dailyPrices.symbol, desc(t.dailyPrices.date));
    return new Map(rows.map((row) => [row.symbol, row.close]));
  }

  async closesOnOrBefore(date: string, symbols: string[]): Promise<Map<string, { date: string; close: number }>> {
    if (!symbols.length) return new Map();
    const rows = await this.db.selectDistinctOn([t.dailyPrices.symbol], { symbol: t.dailyPrices.symbol, date: t.dailyPrices.date, close: t.dailyPrices.close })
      .from(t.dailyPrices).where(and(inArray(t.dailyPrices.symbol, symbols), lte(t.dailyPrices.date, date)))
      .orderBy(t.dailyPrices.symbol, desc(t.dailyPrices.date));
    return new Map(rows.map((row) => [row.symbol, { date: row.date, close: row.close }]));
  }

  async sessionHistory(endDate: string, sessions: number): Promise<DailyRecord[]> {
    const dates = this.db.selectDistinct({ date: t.dailyPrices.date }).from(t.dailyPrices)
      .where(lte(t.dailyPrices.date, endDate)).orderBy(desc(t.dailyPrices.date)).limit(sessions);
    return this.db.select(dailyColumns).from(t.dailyPrices).where(sql`${t.dailyPrices.date} in (select date from (${dates}) as recent)`);
  }

  async latestIndexDaily(): Promise<IndexDailyRecord[]> {
    return this.db.selectDistinctOn([t.indexDaily.code], {
      code: t.indexDaily.code, name: t.indexDaily.name, date: t.indexDaily.date, close: t.indexDaily.close,
      previousClose: t.indexDaily.previousClose, changePercent: t.indexDaily.changePercent,
    }).from(t.indexDaily).orderBy(t.indexDaily.code, desc(t.indexDaily.date));
  }

  async indexDailyBetween(codes: string[] | null, from: string, to: string): Promise<IndexDailyRecord[]> {
    const filters = [gte(t.indexDaily.date, from), lte(t.indexDaily.date, to)];
    if (codes && codes.length) filters.push(inArray(t.indexDaily.code, codes));
    return this.db.select({
      code: t.indexDaily.code, name: t.indexDaily.name, date: t.indexDaily.date, close: t.indexDaily.close,
      previousClose: t.indexDaily.previousClose, changePercent: t.indexDaily.changePercent,
    }).from(t.indexDaily).where(and(...filters)).orderBy(asc(t.indexDaily.code), asc(t.indexDaily.date));
  }

  async brokerDailySummaryBetween(from: string, to: string) { return brokerDailyBetween(this.db, from, to); }
  async latestBrokerSummaryDate() { return latestBrokerSummaryDate(this.db); }
  async brokerDirectory() { return idxBrokerMembers(this.db); }
  async latestBrokerDirectoryAsOf() { return latestIdxBrokerMembersAsOf(this.db); }
  async issuerProfile(symbol: string, language = "id-id") { return getIdxIssuerProfile(this.db, symbol, language); }

  async latestIndexIntraday(): Promise<IndexIntradayRecord[]> {
    return this.db.selectDistinctOn([t.indexIntraday.code], {
      code: t.indexIntraday.code, name: t.indexIntraday.name, ts: t.indexIntraday.ts, last: t.indexIntraday.last, changePercent: t.indexIntraday.changePercent,
    }).from(t.indexIntraday).orderBy(t.indexIntraday.code, desc(t.indexIntraday.ts));
  }

  async latestForeignDate(): Promise<string | null> {
    const [row] = await this.db.select({ date: max(t.dailyPrices.date) }).from(t.dailyPrices).where(isNotNull(t.dailyPrices.foreignBuy));
    return row?.date ?? null;
  }

  async foreignHistory(endDate: string, sessions: number): Promise<DailyRecord[]> {
    const dates = this.db.selectDistinct({ date: t.dailyPrices.date }).from(t.dailyPrices)
      .where(and(isNotNull(t.dailyPrices.foreignBuy), lte(t.dailyPrices.date, endDate))).orderBy(desc(t.dailyPrices.date)).limit(sessions);
    return this.db.select(dailyColumns).from(t.dailyPrices)
      .where(and(isNotNull(t.dailyPrices.foreignBuy), sql`${t.dailyPrices.date} in (select date from (${dates}) as recent)`));
  }

  async actions(symbol: string): Promise<ActionRecord[]> {
    return this.db.select({ exDate: t.corporateActions.exDate, type: t.corporateActions.type, description: t.corporateActions.description, asOf: t.corporateActions.asOf })
      .from(t.corporateActions).where(eq(t.corporateActions.symbol, symbol)).orderBy(desc(t.corporateActions.exDate));
  }

  async actionsBetween(from: string, to: string): Promise<ActionCalendarRecord[]> {
    const rows = await this.db.select({
      symbol: t.corporateActions.symbol, exDate: t.corporateActions.exDate, type: t.corporateActions.type, source: t.corporateActions.source, sourceCategory: t.corporateActions.sourceCategory, description: t.corporateActions.description,
      amount: t.corporateActions.amount, ratio: t.corporateActions.ratio, shares: t.corporateActions.shares, sharesAfter: t.corporateActions.sharesAfter, asOf: t.corporateActions.asOf,
    }).from(t.corporateActions).where(and(gte(t.corporateActions.exDate, from), lte(t.corporateActions.exDate, to)))
      .orderBy(asc(t.corporateActions.exDate), asc(t.corporateActions.symbol), asc(t.corporateActions.type));
    return rows.map((row) => ({ ...row, exDate: row.exDate! }));
  }

  async latestActionAsOf(): Promise<Date | null> {
    const [row] = await this.db.select({ asOf: max(t.corporateActions.asOf) }).from(t.corporateActions);
    return row?.asOf ?? null;
  }

  async news(query: NewsQuery): Promise<NewsRecord[]> {
    return this.db.select({
      publishedAt: t.newsItems.publishedAt, publishedAtEstimated: t.newsItems.publishedAtEstimated, title: t.newsItems.title, url: t.newsItems.url,
      outlet: t.newsItems.outlet, summary: t.newsItems.summary, symbols: t.newsItems.symbols,
    }).from(t.newsItems).where(query.symbol ? arrayContains(t.newsItems.symbols, [query.symbol]) : undefined)
      .orderBy(desc(t.newsItems.publishedAt), asc(t.newsItems.id)).offset(query.offset).limit(query.limit);
  }

  async latestNewsAt(): Promise<Date | null> {
    const [row] = await this.db.select({ at: max(t.newsItems.publishedAt) }).from(t.newsItems);
    return row?.at ?? null;
  }

  async announcements(query: NewsQuery) {
    const filters = query.symbol ? [eq(t.announcements.symbol, query.symbol)] : [];
    return this.db.select({ externalId: t.announcements.externalId, symbol: t.announcements.symbol, publishedAt: t.announcements.publishedAt, title: t.announcements.title, documentUrl: t.announcements.documentUrl })
      .from(t.announcements).where(filters.length ? and(...filters) : undefined).orderBy(desc(t.announcements.publishedAt)).offset(query.offset).limit(query.limit);
  }
  async latestAnnouncementAt(): Promise<Date | null> {
    const [row] = await this.db.select({ publishedAt: max(t.announcements.publishedAt) }).from(t.announcements);
    return row?.publishedAt ?? null;
  }

  async fundamentals(symbol: string): Promise<FundamentalRecord[]> {
    return this.db.select({
      periodEnd: t.financials.periodEnd, periodType: t.financials.periodType, metric: t.financials.metric, value: t.financials.value,
      unit: t.financials.unit, currency: t.financials.currency, source: t.financials.source,
    }).from(t.financials).where(eq(t.financials.symbol, symbol)).orderBy(desc(t.financials.periodEnd), asc(t.financials.periodType), asc(t.financials.metric));
  }

  async ratios(symbols: string[]): Promise<RatioRecord[]> {
    if (!symbols.length) return [];
    return this.db.select({ symbol: t.stockRatios.symbol, ratio: t.stockRatios.ratio, ratioSource: t.stockRatios.ratioSource, value: t.stockRatios.value, date: t.stockRatios.date })
      .from(t.stockRatios).where(inArray(t.stockRatios.symbol, symbols));
  }

  async macro(perSeries: number): Promise<MacroRecord[]> {
    const result = await this.db.execute<{ series: string; date: string; value: string; link: string | null }>(sql`
      select series, date::text as date, value::text as value, link from (
        select m.*, row_number() over (partition by series order by date desc) as n from macro_observations m
      ) ranked where n <= ${perSeries} order by series asc, date desc`);
    return [...result].map((row) => ({ series: row.series, date: row.date, value: Number(row.value), link: row.link }));
  }
}

/** Stored TradingView logo id of a symbol (null when unknown or never captured). */
export async function securityLogoId(db: EngineDb, symbol: string): Promise<string | null> {
  const rows = await db.select({ logoId: t.securities.logoId }).from(t.securities).where(eq(t.securities.symbol, symbol)).limit(1);
  return rows[0]?.logoId ?? null;
}
