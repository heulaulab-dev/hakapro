// Yahoo Finance fundamentals timeseries (DATA-ENGINE.md §5.5): per-symbol income statement, balance sheet and cash
// flow lines for ~4 annual and ~5 quarterly periods, without a crumb or cookie. Unofficial and best-effort (§8.6).
//   GET /ws/fundamentals-timeseries/v1/finance/timeseries/<SYM>.JK?type=annualNetIncome,quarterlyNetIncome,…
// One request per symbol carries every metric for both period types. Values are as reported, in the filing
// currency (`currencyCode`: IDR for most issuers, USD for some coal/energy issuers); EPS is per share; share counts
// are plain shares.
import { z } from "zod";
import { YAHOO_ORIGIN } from "./yahoo";

export const FUNDAMENTALS_PATH = "/ws/fundamentals-timeseries/v1/finance/timeseries/";
/** First period end requested (the same start as the price history); Yahoo returns ~4 annual + ~5 quarterly anyway. */
export const FUNDAMENTALS_PERIOD_START = "2020-01-01";

export type MetricUnit = "amount" | "per_share" | "shares";
export type PeriodType = "annual" | "quarterly";

/**
 * Yahoo line → engine metric key. `amount` is in the filing currency, `per_share` in the filing currency per share.
 * Signs are as reported (capital expenditure and dividends paid are negative cash flows).
 */
export const FUNDAMENTAL_METRICS = {
  // Income statement
  TotalRevenue: { key: "revenue", unit: "amount" },
  GrossProfit: { key: "grossProfit", unit: "amount" },
  OperatingIncome: { key: "operatingIncome", unit: "amount" },
  PretaxIncome: { key: "pretaxIncome", unit: "amount" },
  EBITDA: { key: "ebitda", unit: "amount" },
  /** Attributable to owners of the parent. */
  NetIncome: { key: "netIncome", unit: "amount" },
  NetIncomeCommonStockholders: { key: "netIncomeCommon", unit: "amount" },
  BasicEPS: { key: "epsBasic", unit: "per_share" },
  DilutedEPS: { key: "epsDiluted", unit: "per_share" },
  BasicAverageShares: { key: "averageSharesBasic", unit: "shares" },
  DilutedAverageShares: { key: "averageSharesDiluted", unit: "shares" },
  // Balance sheet (period-end values)
  TotalAssets: { key: "totalAssets", unit: "amount" },
  TotalLiabilitiesNetMinorityInterest: { key: "totalLiabilities", unit: "amount" },
  /** Equity attributable to owners of the parent. */
  StockholdersEquity: { key: "equity", unit: "amount" },
  /** Equity including non-controlling interests (total assets − total liabilities). */
  TotalEquityGrossMinorityInterest: { key: "totalEquity", unit: "amount" },
  TotalDebt: { key: "totalDebt", unit: "amount" },
  CashAndCashEquivalents: { key: "cash", unit: "amount" },
  CurrentAssets: { key: "currentAssets", unit: "amount" },
  CurrentLiabilities: { key: "currentLiabilities", unit: "amount" },
  OrdinarySharesNumber: { key: "sharesOutstanding", unit: "shares" },
  ShareIssued: { key: "sharesIssued", unit: "shares" },
  // Cash flow
  OperatingCashFlow: { key: "operatingCashFlow", unit: "amount" },
  CapitalExpenditure: { key: "capitalExpenditure", unit: "amount" },
  FreeCashFlow: { key: "freeCashFlow", unit: "amount" },
  CashDividendsPaid: { key: "dividendsPaid", unit: "amount" },
  CommonStockDividendPaid: { key: "commonDividendsPaid", unit: "amount" },
} as const satisfies Record<string, { key: string; unit: MetricUnit }>;

export type YahooLine = keyof typeof FUNDAMENTAL_METRICS;
export type MetricKey = (typeof FUNDAMENTAL_METRICS)[YahooLine]["key"];
export const METRIC_UNITS: Record<MetricKey, MetricUnit> = Object.fromEntries(Object.values(FUNDAMENTAL_METRICS).map((metric) => [metric.key, metric.unit])) as Record<MetricKey, MetricUnit>;

const LINES = Object.keys(FUNDAMENTAL_METRICS) as YahooLine[];
const PREFIXES = { annual: "annual", quarterly: "quarterly" } as const satisfies Record<PeriodType, string>;
/** Every requested `type`, annual lines first, in a fixed order (a stable URL for the document cache). */
export const FUNDAMENTAL_TYPES = (["annual", "quarterly"] as const).flatMap((period) => LINES.map((line) => `${PREFIXES[period]}${line}`));

/** `period2` is 00:00 WIB of `untilDate` (the day after "today"), so one day's URL is stable. */
export function fundamentalsUrl(ticker: string, untilDate: string): string {
  const epoch = (date: string) => String(Date.parse(`${date}T00:00:00+07:00`) / 1000);
  // The query shape confirmed in discovery (§5.5): type, period1, period2 only.
  const params = new URLSearchParams({ type: FUNDAMENTAL_TYPES.join(","), period1: epoch(FUNDAMENTALS_PERIOD_START), period2: epoch(untilDate) });
  return `${YAHOO_ORIGIN}${FUNDAMENTALS_PATH}${encodeURIComponent(ticker)}?${params}`;
}

const pointSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  periodType: z.string().optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  reportedValue: z.object({ raw: z.number().nullable().optional() }).loose().nullable().optional(),
}).loose();
const resultSchema = z.object({
  meta: z.object({ symbol: z.array(z.string()).min(1), type: z.array(z.string()).min(1) }).loose(),
}).catchall(z.unknown());
const responseSchema = z.object({
  timeseries: z.object({ result: z.array(resultSchema).nullable(), error: z.unknown().nullable().optional() }),
});

export type FundamentalPoint = {
  periodEnd: string; periodType: PeriodType; metric: MetricKey; value: number; unit: MetricUnit;
  /** Filing currency for amounts and per-share values; null for share counts. */
  currency: string | null;
};
export type YahooFundamentals = { ticker: string; points: FundamentalPoint[]; currencies: string[]; skipped: number };

export class FundamentalsMismatchError extends Error {
  constructor(expected: string, got: string) {
    super(`Yahoo fundamentals for ${got} returned where ${expected} was requested`);
    this.name = "FundamentalsMismatchError";
  }
}

const PERIOD_TAGS: Record<PeriodType, string> = { annual: "12M", quarterly: "3M" };

/**
 * Parses one timeseries response into metric points. A type without data (`meta` only), null slots and null values
 * are skipped, never stored as 0. A point whose `periodType` tag contradicts its type prefix is skipped. Unknown
 * types are ignored. The response must be for the requested ticker.
 */
export function parseFundamentals(textBody: string, expectedTicker: string): YahooFundamentals {
  const parsed = responseSchema.parse(JSON.parse(textBody));
  const results = parsed.timeseries.result ?? [];
  const points = new Map<string, FundamentalPoint>();
  const currencies = new Set<string>();
  let skipped = 0;
  for (const result of results) {
    const symbol = result.meta.symbol[0];
    if (symbol.toUpperCase() !== expectedTicker.toUpperCase()) throw new FundamentalsMismatchError(expectedTicker, symbol);
    const type = result.meta.type[0];
    const period = type.startsWith(PREFIXES.annual) ? "annual" : type.startsWith(PREFIXES.quarterly) ? "quarterly" : null;
    const line = period ? (type.slice(PREFIXES[period].length) as YahooLine) : null;
    if (!period || !line || !(line in FUNDAMENTAL_METRICS)) continue;
    const metric = FUNDAMENTAL_METRICS[line];
    const series = result[type];
    if (!Array.isArray(series)) continue;
    for (const slot of series) {
      if (slot === null || slot === undefined) continue;
      const point = pointSchema.safeParse(slot);
      const raw = point.success ? point.data.reportedValue?.raw : null;
      if (!point.success || raw === null || raw === undefined || !Number.isFinite(raw)) { skipped += 1; continue; }
      if (point.data.periodType && point.data.periodType !== PERIOD_TAGS[period]) { skipped += 1; continue; }
      const currency = metric.unit === "shares" ? null : point.data.currencyCode ?? null;
      if (currency) currencies.add(currency);
      points.set(`${point.data.asOfDate}|${period}|${metric.key}`, { periodEnd: point.data.asOfDate, periodType: period, metric: metric.key, value: raw, unit: metric.unit, currency });
    }
  }
  return {
    ticker: expectedTicker, currencies: [...currencies].sort(), skipped,
    points: [...points.values()].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.periodType.localeCompare(b.periodType) || a.metric.localeCompare(b.metric)),
  };
}
