// Valuation ratios from stored financial statements and the latest close (E5). Pure functions; the `ratios` job
// (src/jobs/ratios.ts) feeds them from the database and stores the results in `stock_ratios` as `derived` rows.
//
// Trailing twelve months (TTM) of a flow metric (net income, dividends paid), in this order:
//   1. the newest annual value when no newer quarter exists                            basis `annual:<end>`
//   2. the sum of the four consecutive quarters ending at the newest quarter            basis `ttm-4q:<end>`
//   3. last annual + this fiscal year's quarters − the same quarters a year earlier     basis `ttm-ytd:<end>`
//      (Yahoo often skips a quarter, e.g. BBCA has no Q3-2025, so 2 rescues most issuers)
//   4. otherwise the newest annual value, even when a newer quarter exists              basis `annual:<end>`
// Balance-sheet lines use the newest period end of either type (`balance:<end>`). Any input whose period ended more
// than MAX_PERIOD_AGE_DAYS before the price date counts as missing. Amounts are converted to IDR with `fx` (1 for
// IDR filers; JISDOR for USD filers) wherever they meet the IDR price.
//
//   eps            = NI_ttm × fx / shares                                   IDR per share (may be negative)
//   per            = price / eps                      null when eps ≤ 0 (NON_POSITIVE_EARNINGS)
//   pbv            = price / (equity × fx / shares)   null when equity ≤ 0 (NON_POSITIVE_EQUITY)
//   roe            = NI_ttm / equity                  null when equity ≤ 0 (NON_POSITIVE_EQUITY); fraction
//   roa            = NI_ttm / totalAssets             null when totalAssets ≤ 0; fraction
//   der            = totalLiabilities / totalEquity   null when totalEquity ≤ 0 (NON_POSITIVE_EQUITY); multiple
//   dividendYield  = DPS_365d / price                 cash dividends per share with an ex-date in the 365 days up to
//                                                     the price date (Yahoo events); a true 0 when the price history
//                                                     covers the window and no dividend went ex. Without that
//                                                     coverage: |dividends paid TTM| × fx / (price × shares). Fraction.
// NI = net income attributable to owners of the parent (`netIncome`, else `netIncomeCommon`); equity = parent equity
// (`equity`); totalEquity includes non-controlling interests (`totalEquity`, else `equity`), matching
// `totalLiabilities`, which is net of them. shares = listed shares (Pasardana), else Yahoo's ordinary shares number.
// `missing` results are not stored, so the screener can fall back to another source; `not_meaningful` results are
// stored with a null value and a note, and are never replaced by another source's number.

export const DERIVATION_VERSION = "ratios-v1";
/** Inputs older than this (period end → price date) are treated as missing: about six quarters. */
export const MAX_PERIOD_AGE_DAYS = 550;
export const DIVIDEND_WINDOW_DAYS = 365;

export type RatioKey = "per" | "pbv" | "roe" | "roa" | "eps" | "der" | "dividendYield";
export const RATIO_KEYS: RatioKey[] = ["per", "pbv", "roe", "roa", "eps", "der", "dividendYield"];

export type FinancialFact = {
  periodEnd: string; periodType: "annual" | "quarterly"; metric: string; value: number; currency: string | null;
  /** Provenance of the stored row, carried to the derived row. */
  asOf?: Date; rawRef?: string | null; source?: string;
};

export type Picked = { value: number; basis: string; periodEnd: string; currency: string | null; facts: FinancialFact[] };

export type RatioStatus = "ok" | "not_meaningful" | "missing";
export type RatioResult = {
  ratio: RatioKey; status: RatioStatus; value: number | null; basis: string; note: string | null;
  inputs: Record<string, string | number | null>;
  /** Financial rows the value rests on (newest provenance is stored with the ratio). */
  facts: FinancialFact[];
};

export type RatioInput = {
  /** Session date of `price`. */
  priceDate: string;
  price: number | null;
  /** Listed shares from the universe (Pasardana); null to fall back to the statements' share count. */
  shares: number | null;
  facts: FinancialFact[];
  /** IDR per unit of `currency` on or before the price date; IDR → 1. Null when no rate is known. */
  fx(currency: string): { rate: number; date: string | null } | null;
  /** Cash dividends per share (IDR) with ex-dates; null when the price history does not cover the 365-day window. */
  dividends: Array<{ exDate: string; amount: number }> | null;
};

const DAY_MS = 86_400_000;
const days = (from: string, to: string) => (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS;
const pad = (value: number) => String(value).padStart(2, "0");

/** The month end `months` months from a period end (quarter ends are month ends). */
export function shiftMonthEnd(periodEnd: string, months: number): string {
  const year = Number(periodEnd.slice(0, 4));
  const month = Number(periodEnd.slice(5, 7)) - 1 + months;
  const y = year + Math.floor(month / 12);
  const m = ((month % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return `${y}-${pad(m + 1)}-${pad(last)}`;
}

const sameCurrency = (facts: FinancialFact[]) => new Set(facts.map((fact) => fact.currency)).size <= 1;

function byEnd(facts: FinancialFact[], metric: string, type: FinancialFact["periodType"]) {
  return new Map(facts.filter((fact) => fact.metric === metric && fact.periodType === type).map((fact) => [fact.periodEnd, fact]));
}

function picked(facts: FinancialFact[], basis: string, periodEnd: string, value: number): Picked | null {
  if (!sameCurrency(facts)) return null;
  return { value, basis: `${basis}:${periodEnd}`, periodEnd, currency: facts[0]?.currency ?? null, facts };
}

/** Trailing-twelve-month value of a flow metric (see the header for the order), or null. */
export function trailing(facts: FinancialFact[], metric: string, asOfDate: string): Picked | null {
  const quarters = byEnd(facts, metric, "quarterly");
  const annuals = byEnd(facts, metric, "annual");
  const latestQ = [...quarters.keys()].sort().at(-1) ?? null;
  const latestA = [...annuals.keys()].sort().at(-1) ?? null;
  const fresh = (end: string) => days(end, asOfDate) <= MAX_PERIOD_AGE_DAYS;
  const annual = () => (latestA && fresh(latestA) ? picked([annuals.get(latestA)!], "annual", latestA, annuals.get(latestA)!.value) : null);

  if (!latestQ || (latestA && latestA >= latestQ)) return annual();
  if (!fresh(latestQ)) return annual();

  const four = [0, 1, 2, 3].map((i) => quarters.get(shiftMonthEnd(latestQ, -3 * i)));
  if (four.every(Boolean)) {
    const used = four as FinancialFact[];
    return picked(used, "ttm-4q", latestQ, used.reduce((sum, fact) => sum + fact.value, 0));
  }

  if (latestA && shiftMonthEnd(latestA, 12) >= latestQ) {
    const ytdEnds: string[] = [];
    for (let end = shiftMonthEnd(latestA, 3); end <= latestQ; end = shiftMonthEnd(end, 3)) ytdEnds.push(end);
    const ytd = ytdEnds.map((end) => quarters.get(end));
    const prior = ytdEnds.map((end) => quarters.get(shiftMonthEnd(end, -12)));
    if (ytdEnds.at(-1) === latestQ && ytd.every(Boolean) && prior.every(Boolean)) {
      const used = [annuals.get(latestA)!, ...(ytd as FinancialFact[]), ...(prior as FinancialFact[])];
      const value = annuals.get(latestA)!.value + (ytd as FinancialFact[]).reduce((s, f) => s + f.value, 0) - (prior as FinancialFact[]).reduce((s, f) => s + f.value, 0);
      return picked(used, "ttm-ytd", latestQ, value);
    }
  }
  return annual();
}

/** Newest period-end value of a balance-sheet line (either period type), or null. */
export function latestBalance(facts: FinancialFact[], metric: string, asOfDate: string): Picked | null {
  const rows = facts.filter((fact) => fact.metric === metric).sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || (a.periodType === "quarterly" ? -1 : 1));
  const row = rows[0];
  if (!row || days(row.periodEnd, asOfDate) > MAX_PERIOD_AGE_DAYS) return null;
  return picked([row], "balance", row.periodEnd, row.value);
}

const firstOf = (...candidates: Array<Picked | null>) => candidates.find((candidate): candidate is Picked => candidate !== null) ?? null;

/** Derives every ratio for one symbol. Never returns 0 for a missing input: missing is `missing`, with value null. */
export function deriveRatios(input: RatioInput): RatioResult[] {
  const { facts, priceDate: asOf } = input;
  const price = input.price !== null && input.price > 0 ? input.price : null;
  const ni = firstOf(trailing(facts, "netIncome", asOf), trailing(facts, "netIncomeCommon", asOf));
  const equity = latestBalance(facts, "equity", asOf);
  const totalEquity = firstOf(latestBalance(facts, "totalEquity", asOf), equity);
  const liabilities = latestBalance(facts, "totalLiabilities", asOf);
  const assets = latestBalance(facts, "totalAssets", asOf);
  const statementShares = latestBalance(facts, "sharesOutstanding", asOf);
  const shares = input.shares !== null && input.shares > 0 ? input.shares : statementShares && statementShares.value > 0 ? statementShares.value : null;
  const sharesSource = input.shares !== null && input.shares > 0 ? "universe" : shares ? statementShares!.basis : null;
  const rate = (pick: Picked | null) => (pick?.currency ? input.fx(pick.currency) : pick ? { rate: 1, date: null } : null);

  const results: RatioResult[] = [];
  const add = (ratio: RatioKey, parts: { value?: number | null; status: RatioStatus; basis?: string; note?: string | null; inputs?: RatioResult["inputs"]; facts?: FinancialFact[] }) => {
    const value = parts.status === "ok" && parts.value !== undefined && parts.value !== null && Number.isFinite(parts.value) ? parts.value : null;
    const status = parts.status === "ok" && value === null ? "missing" : parts.status;
    results.push({ ratio, status, value, basis: parts.basis ?? "", note: parts.note ?? null, inputs: parts.inputs ?? {}, facts: parts.facts ?? [] });
  };
  const missing = (ratio: RatioKey, note: string) => add(ratio, { status: "missing", note });

  // eps / per
  const niFx = rate(ni);
  if (!ni) { missing("eps", "NO_NET_INCOME"); missing("per", "NO_NET_INCOME"); }
  else if (!shares) { missing("eps", "NO_SHARES"); missing("per", "NO_SHARES"); }
  else if (!niFx) { missing("eps", "NO_FX_RATE"); missing("per", "NO_FX_RATE"); }
  else {
    const eps = (ni.value * niFx.rate) / shares;
    const inputs = { netIncome: ni.value, currency: ni.currency, fx: niFx.rate, fxDate: niFx.date, shares, sharesSource };
    add("eps", { status: "ok", value: eps, basis: ni.basis, inputs, facts: ni.facts });
    if (price === null) missing("per", "NO_PRICE");
    else if (eps <= 0) add("per", { status: "not_meaningful", basis: ni.basis, note: "NON_POSITIVE_EARNINGS", inputs: { ...inputs, price, priceDate: asOf, eps }, facts: ni.facts });
    else add("per", { status: "ok", value: price / eps, basis: ni.basis, inputs: { ...inputs, price, priceDate: asOf, eps }, facts: ni.facts });
  }

  // pbv
  const eqFx = rate(equity);
  if (!equity) missing("pbv", "NO_EQUITY");
  else if (equity.value <= 0) add("pbv", { status: "not_meaningful", basis: equity.basis, note: "NON_POSITIVE_EQUITY", inputs: { equity: equity.value }, facts: equity.facts });
  else if (price === null) missing("pbv", "NO_PRICE");
  else if (!shares) missing("pbv", "NO_SHARES");
  else if (!eqFx) missing("pbv", "NO_FX_RATE");
  else {
    const bookPerShare = (equity.value * eqFx.rate) / shares;
    add("pbv", { status: "ok", value: price / bookPerShare, basis: equity.basis, inputs: { equity: equity.value, currency: equity.currency, fx: eqFx.rate, fxDate: eqFx.date, shares, sharesSource, bookPerShare, price, priceDate: asOf }, facts: equity.facts });
  }

  // roe / roa (same-currency quotients: no FX)
  const sameFilings = (a: Picked, b: Picked) => a.currency === b.currency;
  if (!ni || !equity) missing("roe", ni ? "NO_EQUITY" : "NO_NET_INCOME");
  else if (equity.value <= 0) add("roe", { status: "not_meaningful", basis: `${ni.basis}/${equity.basis}`, note: "NON_POSITIVE_EQUITY", inputs: { netIncome: ni.value, equity: equity.value }, facts: [...ni.facts, ...equity.facts] });
  else if (!sameFilings(ni, equity)) missing("roe", "CURRENCY_MISMATCH");
  else add("roe", { status: "ok", value: ni.value / equity.value, basis: `${ni.basis}/${equity.basis}`, inputs: { netIncome: ni.value, equity: equity.value, currency: ni.currency }, facts: [...ni.facts, ...equity.facts] });

  if (!ni || !assets) missing("roa", ni ? "NO_TOTAL_ASSETS" : "NO_NET_INCOME");
  else if (assets.value <= 0) add("roa", { status: "not_meaningful", basis: `${ni.basis}/${assets.basis}`, note: "NON_POSITIVE_ASSETS", inputs: { netIncome: ni.value, totalAssets: assets.value }, facts: [...ni.facts, ...assets.facts] });
  else if (!sameFilings(ni, assets)) missing("roa", "CURRENCY_MISMATCH");
  else add("roa", { status: "ok", value: ni.value / assets.value, basis: `${ni.basis}/${assets.basis}`, inputs: { netIncome: ni.value, totalAssets: assets.value, currency: ni.currency }, facts: [...ni.facts, ...assets.facts] });

  // der
  if (!liabilities || !totalEquity) missing("der", liabilities ? "NO_EQUITY" : "NO_TOTAL_LIABILITIES");
  else if (totalEquity.value <= 0) add("der", { status: "not_meaningful", basis: totalEquity.basis, note: "NON_POSITIVE_EQUITY", inputs: { totalLiabilities: liabilities.value, totalEquity: totalEquity.value }, facts: [...liabilities.facts, ...totalEquity.facts] });
  else if (!sameFilings(liabilities, totalEquity)) missing("der", "CURRENCY_MISMATCH");
  else add("der", { status: "ok", value: liabilities.value / totalEquity.value, basis: totalEquity.basis, inputs: { totalLiabilities: liabilities.value, totalEquity: totalEquity.value, currency: liabilities.currency }, facts: [...liabilities.facts, ...totalEquity.facts] });

  // dividendYield
  if (price === null) missing("dividendYield", "NO_PRICE");
  else if (input.dividends) {
    const perShare = input.dividends.filter((row) => row.exDate <= asOf && days(row.exDate, asOf) < DIVIDEND_WINDOW_DAYS).reduce((sum, row) => sum + row.amount, 0);
    add("dividendYield", { status: "ok", value: perShare / price, basis: "dividends-365d", inputs: { dividendsPerShare: perShare, price, priceDate: asOf } });
  } else {
    const paid = firstOf(trailing(facts, "commonDividendsPaid", asOf), trailing(facts, "dividendsPaid", asOf));
    const paidFx = rate(paid);
    if (!paid) missing("dividendYield", "NO_DIVIDEND_DATA");
    else if (!shares) missing("dividendYield", "NO_SHARES");
    else if (!paidFx) missing("dividendYield", "NO_FX_RATE");
    else {
      const marketCap = price * shares;
      add("dividendYield", { status: "ok", value: (Math.abs(paid.value) * paidFx.rate) / marketCap, basis: paid.basis, inputs: { dividendsPaid: paid.value, currency: paid.currency, fx: paidFx.rate, fxDate: paidFx.date, price, priceDate: asOf, shares, sharesSource }, facts: paid.facts });
    }
  }
  return results;
}
