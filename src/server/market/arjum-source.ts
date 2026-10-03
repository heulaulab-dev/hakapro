import "server-only";
import { classifySessionDate, withFreshness, type Freshness, type WithFreshness } from "@/lib/freshness";
import { logWarn } from "@/server/log";
import { ArjumClient, type RawFetcher } from "@/server/providers/arjum/client";
import {
  brokerAccumulationResponseSchema, brokerSummaryResponseSchema, doneDetailsResponseSchema, financialStatementsResponseSchema,
  healthResponseSchema, historyResponseSchema, insidersResponseSchema, marketCapResponseSchema, screenerResponseSchema,
  searchResponseSchema, seasonalityResponseSchema,
} from "@/server/schemas/arjum";
import {
  normalizeBrokerAccumulation, normalizeBrokerSummary, normalizeDoneDetails, normalizeFinancialStatements, normalizeHistory,
  normalizeInsiders, normalizeMarketCap, normalizeSearch, normalizeSeasonality,
} from "@/server/services/arjum-normalize";
import { parseStrategyScreen } from "@/server/services/why-matched";
import { BaseMarketDataSource, type BrokerAccumulationQuery, type FinancialsQuery, type HistoryQuery, type InsidersQuery, type PageQuery } from "./source";

export type Clock = () => Date;

/**
 * arjum lane. Freshness rules (MIGRATION §9.4): "latest snapshot" datasets are classified by their
 * data date against the IDX session clock; series datasets are HISTORICAL as of their newest point.
 */
export class ArjumSource extends BaseMarketDataSource {
  constructor(
    private readonly fetchRaw: RawFetcher,
    readonly id: string = "arjum",
    protected readonly clock: Clock = () => new Date(),
  ) {
    super();
  }

  static fromEnv(): ArjumSource {
    return new ArjumSource(new ArjumClient().get);
  }

  protected wrap<T>(data: T, freshness: Freshness, asOf: string | null, period?: string): WithFreshness<T> {
    return withFreshness(data, { freshness, asOf, source: this.id, period });
  }

  protected snapshot<T>(data: T, asOf: string | null): WithFreshness<T> {
    return this.wrap(data, classifySessionDate(asOf, this.clock()), asOf);
  }

  async search(q: string, signal?: AbortSignal) {
    const rows = normalizeSearch(await this.fetchRaw("/api/search", searchResponseSchema, { q }, signal));
    const latest = rows.map((row) => row.lastDate).sort().at(-1) ?? null;
    return this.snapshot(rows, latest);
  }

  async strategies(signal?: AbortSignal) {
    const { screen, issues } = parseStrategyScreen(await this.fetchRaw("/api/screener/latest", screenerResponseSchema, {}, signal));
    for (const issue of issues) logWarn("why_matched_issue", { source: this.id, ...issue });
    return this.snapshot(screen, screen.date);
  }

  async brokerSummary(symbol: string, signal?: AbortSignal) {
    const data = normalizeBrokerSummary(await this.fetchRaw(`/api/broker-summary/${symbol}`, brokerSummaryResponseSchema, {}, signal));
    return this.snapshot(data, data.endDate);
  }

  async brokerAccumulation(symbol: string, query: BrokerAccumulationQuery, signal?: AbortSignal) {
    const data = normalizeBrokerAccumulation(await this.fetchRaw(`/api/broker-accumulation/${symbol}`, brokerAccumulationResponseSchema, { start_date: query.startDate, end_date: query.endDate, top: query.top, brokers: query.brokers }, signal));
    return this.wrap(data, "HISTORICAL", data.endDate);
  }

  async history(symbol: string, query: HistoryQuery, signal?: AbortSignal) {
    const data = normalizeHistory(await this.fetchRaw(`/api/history/${symbol}`, historyResponseSchema, { limit: query.limit, frame: query.frame }, signal));
    return this.wrap(data, "HISTORICAL", data.rows.at(-1)?.date ?? null);
  }

  async seasonality(symbol: string, signal?: AbortSignal) {
    // TODO(verify): the provider gives no as-of date for seasonality, so it is reported as UNAVAILABLE freshness.
    return this.wrap(normalizeSeasonality(await this.fetchRaw(`/api/seasonal/${symbol}`, seasonalityResponseSchema, {}, signal)), "HISTORICAL", null);
  }

  async marketCap(query: PageQuery & { date?: string }, signal?: AbortSignal) {
    const data = normalizeMarketCap(await this.fetchRaw("/api/market-cap", marketCapResponseSchema, { date: query.date, page: query.page, per_page: query.perPage }, signal));
    return this.snapshot(data, data.date);
  }

  async financialStatements(symbol: string, query: FinancialsQuery, signal?: AbortSignal) {
    const data = normalizeFinancialStatements(await this.fetchRaw(`/api/financial-statements/${symbol}`, financialStatementsResponseSchema, { report_type: query.reportType, period: query.period, limit: query.limit, year: query.year }, signal));
    const newest = data.periods[0];
    return this.wrap(data, "HISTORICAL", newest ? newest.fetchedAt.replace(" ", "T") : null, newest?.label);
  }

  async insiders(symbol: string, query: InsidersQuery, signal?: AbortSignal) {
    const { data, issues } = normalizeInsiders(await this.fetchRaw(`/api/insiders/${symbol}`, insidersResponseSchema, { page: query.page, limit: query.limit, action_type: query.actionType }, signal));
    for (const issue of issues) logWarn("unparseable_provider_number", { source: this.id, ...issue });
    return this.wrap(data, "HISTORICAL", data.rows.map((row) => row.date).sort().at(-1) ?? null);
  }

  async doneDetails(symbol: string, query: PageQuery & { date?: string }, signal?: AbortSignal) {
    const data = normalizeDoneDetails(await this.fetchRaw("/api/done-details", doneDetailsResponseSchema, { code: symbol, date: query.date, page: query.page, per_page: query.perPage }, signal));
    return this.snapshot(data, data.date);
  }

  async providerHealth(signal?: AbortSignal) {
    const data = await this.fetchRaw("/api/health", healthResponseSchema, {}, signal);
    return this.wrap(data, "HISTORICAL", this.clock().toISOString());
  }
}
