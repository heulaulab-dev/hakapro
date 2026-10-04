import "server-only";
import { classifySessionDate, jakartaClock, withFreshness, type Freshness, type WithFreshness } from "@/lib/freshness";
import { logWarn } from "@/server/log";
import { ArjumClient, lastObservedQuota, type RawFetcher } from "@/server/providers/arjum/client";
import {
  analysisResponseSchema, brokerAccumulationResponseSchema, brokerSummaryResponseSchema, doneDetailsResponseSchema, financialStatementsResponseSchema,
  healthResponseSchema, historyResponseSchema, insidersResponseSchema, marketCapResponseSchema, priceResponseSchema, screenerResponseSchema,
  searchResponseSchema, seasonalityResponseSchema,
} from "@/server/schemas/arjum";
import { parseAnalysis } from "@/server/services/analysis-parse";
import {
  normalizeBrokerAccumulation, normalizeBrokerSummary, normalizeDoneDetails, normalizeFinancialStatements, normalizeHistory,
  normalizeInsiders, normalizeMarketCap, normalizePrice, normalizeSearch, normalizeSeasonality,
} from "@/server/services/arjum-normalize";
import { parseStrategyScreen } from "@/server/services/why-matched";
import { MarketDataError } from "./errors";
import {
  BaseMarketDataSource, type BrokerAccumulationQuery, type BrokerSummaryQuery, type FinancialsQuery, type HistoryQuery, type InsidersQuery,
  type MarketCapQuery, type PageQuery,
} from "./source";

export type Clock = () => Date;

/** Our API names → provider report_type values (verified live: cash flow is "CASH_FLOW_REPORT"). */
export const PROVIDER_REPORT_TYPE = { INCOME_STATEMENT: "INCOME_STATEMENT", BALANCE_SHEET: "BALANCE_SHEET", CASH_FLOW: "CASH_FLOW_REPORT" } as const;
/** Our period names → provider values (documented: quarterly|annually; verified live 2026-10-04). */
export const PROVIDER_PERIOD = { quarterly: "quarterly", annual: "annually" } as const;
/** Our broker-flow names → provider `flow` values. */
export const PROVIDER_FLOW = { all: "all", foreign: "F", domestic: "D" } as const;

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

  async brokerSummary(symbol: string, query: BrokerSummaryQuery = {}, signal?: AbortSignal) {
    const data = normalizeBrokerSummary(await this.fetchRaw(`/api/broker-summary/${symbol}`, brokerSummaryResponseSchema, {
      start_date: query.startDate, end_date: query.endDate,
      flow: query.flow && query.flow !== "all" ? PROVIDER_FLOW[query.flow] : undefined,
      net: query.net ? "true" : undefined,
      broker_limit: query.brokerLimit, level_limit: query.levelLimit,
    }, signal));
    // A multi-session range is history; only a single latest session is classified against the session clock.
    return data.startDate === data.endDate ? this.snapshot(data, data.endDate) : this.wrap(data, "HISTORICAL", data.endDate, `${data.startDate}/${data.endDate}`);
  }

  async brokerAccumulation(symbol: string, query: BrokerAccumulationQuery, signal?: AbortSignal) {
    const data = normalizeBrokerAccumulation(await this.fetchRaw(`/api/broker-accumulation/${symbol}`, brokerAccumulationResponseSchema, { start_date: query.startDate, end_date: query.endDate, top: query.top, brokers: query.brokers }, signal));
    return this.wrap(data, "HISTORICAL", data.endDate);
  }

  async history(symbol: string, query: HistoryQuery, signal?: AbortSignal) {
    const data = normalizeHistory(await this.fetchRaw(`/api/history/${symbol}`, historyResponseSchema, { limit: query.limit, frame: query.frame, start_date: query.startDate, end_date: query.endDate }, signal));
    return this.wrap(data, "HISTORICAL", data.rows.at(-1)?.date ?? null);
  }

  async seasonality(symbol: string, signal?: AbortSignal) {
    // As-of is the last covered month (ISO 8601 YYYY-MM); the period is the covered range.
    const data = normalizeSeasonality(await this.fetchRaw(`/api/seasonal/${symbol}`, seasonalityResponseSchema, {}, signal));
    return this.wrap(data, "HISTORICAL", data.coverage?.to ?? null, data.coverage ? `${data.coverage.from}/${data.coverage.to}` : undefined);
  }

  async marketCap(query: MarketCapQuery, signal?: AbortSignal) {
    const codes = query.symbols?.length ? query.symbols.join(",") : undefined;
    const data = normalizeMarketCap(await this.fetchRaw("/api/market-cap", marketCapResponseSchema, { date: query.date, codes, page: codes ? undefined : query.page, per_page: codes ? undefined : query.perPage }, signal));
    return this.snapshot(data, data.date);
  }

  async financialStatements(symbol: string, query: FinancialsQuery, signal?: AbortSignal) {
    const today = jakartaClock(this.clock()).date;
    const data = normalizeFinancialStatements(await this.fetchRaw(`/api/financial-statements/${symbol}`, financialStatementsResponseSchema, { report_type: query.reportType ? PROVIDER_REPORT_TYPE[query.reportType] : undefined, period: query.period ? PROVIDER_PERIOD[query.period] : undefined, limit: query.limit, year: query.year }, signal), today);
    // As-of is the reporting period end, not the scrape time. A dataset behind the reporting
    // calendar is STALE (data.reportingLag says by how much), never quietly HISTORICAL.
    const newest = data.periods.find((period) => period.periodEnd === data.reportingLag.latestPeriodEnd);
    return this.wrap(data, data.reportingLag.behind ? "STALE" : "HISTORICAL", data.reportingLag.latestPeriodEnd, newest?.label);
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

  async price(symbol: string, signal?: AbortSignal) {
    const now = this.clock();
    const data = normalizePrice(await this.fetchRaw(`/api/price/${symbol}`, priceResponseSchema, {}, signal), jakartaClock(now).date);
    // As-of carries the last trade time when there was a trade today (WIB wall clock).
    const asOf = data.sessionDate && data.lastTradeTime ? `${data.sessionDate}T${data.lastTradeTime}+07:00` : data.sessionDate;
    return this.wrap(data, classifySessionDate(data.sessionDate, now), asOf);
  }

  async analysis(symbol: string, signal?: AbortSignal) {
    const { data, issues, recognizedSections } = parseAnalysis(await this.fetchRaw(`/api/analysis/${symbol}`, analysisResponseSchema, {}, signal));
    for (const issue of issues) logWarn("analysis_unparsed", { source: this.id, symbol, ...issue });
    // Text with none of the known sections is a changed contract, not an analysis to show.
    if (recognizedSections === 0) throw new MarketDataError("MALFORMED_PROVIDER_RESPONSE", "Analysis text has no recognized sections", 502);
    return this.snapshot(data, data.date);
  }

  async providerHealth(signal?: AbortSignal) {
    const health = await this.fetchRaw("/api/health", healthResponseSchema, {}, signal);
    const data = { ...health, quota: lastObservedQuota() };
    return this.wrap(data, "HISTORICAL", this.clock().toISOString());
  }
}
