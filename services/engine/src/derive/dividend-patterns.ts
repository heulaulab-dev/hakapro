/** Historical cash-dividend observations. Prices must be split-adjusted daily closes; trading sessions come from rows. */
export type DividendPrice = { date: string; close: number; value: number | null };
export type CashDividend = { exDate: string; amount: number };

type Observation = {
  exDate: string; amount: number; cumDate: string; cumClose: number; exClose: number;
  runUpPercent: number | null; exDropPercentOfDividend: number; recoverySessions: number | null;
  heldThroughExPercent: number; observedSessionsAfterEx: number;
};

export type DividendPatterns = {
  asOf: string; close: number; priceHistoryFrom: string; averageValue20: number | null; liquidityEligible: boolean;
  history: Observation[];
  projections: Array<{ exDate: string; amount: number; basedOnExDate: string }>;
  yield: { trailing: number | null; ahead: number | null; selected: number | null };
  medians: { runUpPercent: number | null; exDropPercentOfDividend: number | null; recoverySessions: number | null; heldThroughExPercent: number | null };
  recoveredWithin15Rate: number | null;
  patterns: { lowTrapRisk: boolean; capture: boolean; runUp: boolean; highYield: boolean };
};

const DAY_MS = 86_400_000;
const at = (date: string) => Date.parse(`${date}T00:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((at(b) - at(a)) / DAY_MS);
const addDays = (date: string, days: number) => new Date(at(date) + days * DAY_MS).toISOString().slice(0, 10);
const median = (values: number[]) => {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const value = ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  return Number.isFinite(value) ? value : null;
};

/** Returns null without a stored positive close. A null metric means its inputs or observation window are incomplete. */
export function deriveDividendPatterns(prices: DividendPrice[], dividends: CashDividend[]): DividendPatterns | null {
  const bars = prices.filter((row) => Number.isFinite(row.close) && row.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  const latest = bars.at(-1);
  if (!latest) return null;
  const asOf = latest.date;
  const startFiveYears = new Date(at(asOf));
  startFiveYears.setUTCFullYear(startFiveYears.getUTCFullYear() - 5);
  const cutoff = startFiveYears.toISOString().slice(0, 10);
  const actions = dividends.filter((row) => Number.isFinite(row.amount) && row.amount > 0).sort((a, b) => a.exDate.localeCompare(b.exDate));
  const indexByDate = new Map(bars.map((row, index) => [row.date, index]));

  const history: Observation[] = actions.flatMap((action) => {
    if (action.exDate < cutoff || action.exDate > asOf) return [];
    const exIndex = indexByDate.get(action.exDate);
    if (exIndex === undefined || exIndex === 0) return [];
    const cum = bars[exIndex - 1], ex = bars[exIndex];
    const before = bars[exIndex - 16];
    let recoverySessions: number | null = null;
    for (let index = exIndex; index < bars.length; index++) {
      if (bars[index].close >= cum.close) { recoverySessions = index - exIndex + 1; break; }
    }
    return [{
      exDate: action.exDate, amount: action.amount, cumDate: cum.date, cumClose: cum.close, exClose: ex.close,
      runUpPercent: before ? (cum.close / before.close - 1) * 100 : null,
      exDropPercentOfDividend: ((cum.close - ex.close) / action.amount) * 100,
      recoverySessions, heldThroughExPercent: ((ex.close + action.amount) / cum.close - 1) * 100,
      observedSessionsAfterEx: bars.length - exIndex,
    }];
  });

  const last20 = bars.slice(-20);
  const averageValue20 = last20.length === 20 && last20.every((row) => row.value !== null && Number.isFinite(row.value) && row.value >= 0)
    ? last20.reduce((sum, row) => sum + row.value!, 0) / 20 : null;
  const liquidityEligible = averageValue20 !== null && averageValue20 >= 1_000_000_000;

  const trailingStart = addDays(asOf, -365);
  const fullYearCovered = bars[0].date <= trailingStart;
  const paid = actions.filter((row) => row.exDate >= trailingStart && row.exDate <= asOf);
  const projections = paid.flatMap((row) => {
    const exDate = addDays(row.exDate, 364); // 52 weeks keeps the weekday.
    if (exDate <= asOf || actions.some((other) => other.exDate > row.exDate && Math.abs(daysBetween(other.exDate, exDate)) <= 60)) return [];
    return [{ exDate, amount: row.amount, basedOnExDate: row.exDate }];
  }).sort((a, b) => a.exDate.localeCompare(b.exDate));
  const scheduledAhead = actions.filter((row) => row.exDate > asOf && row.exDate <= addDays(asOf, 365));
  const trailingYield = fullYearCovered ? paid.reduce((sum, row) => sum + row.amount, 0) / latest.close : null;
  const aheadYield = fullYearCovered ? (scheduledAhead.reduce((sum, row) => sum + row.amount, 0) + projections.filter((row) => row.exDate <= addDays(asOf, 365)).reduce((sum, row) => sum + row.amount, 0)) / latest.close : null;
  const selectedYield = trailingYield === null || aheadYield === null ? null : Math.max(trailingYield, aheadYield);

  const recoveryEligible = history.filter((row) => row.observedSessionsAfterEx >= 15 || (row.recoverySessions !== null && row.recoverySessions <= 15));
  const recoveredWithin15Rate = recoveryEligible.length ? recoveryEligible.filter((row) => row.recoverySessions !== null && row.recoverySessions <= 15).length / recoveryEligible.length : null;
  const medians = {
    runUpPercent: median(history.flatMap((row) => row.runUpPercent === null ? [] : [row.runUpPercent])),
    exDropPercentOfDividend: median(history.map((row) => row.exDropPercentOfDividend)),
    recoverySessions: median(recoveryEligible.map((row) => row.recoverySessions ?? Infinity)),
    heldThroughExPercent: median(history.map((row) => row.heldThroughExPercent)),
  };
  const enough = liquidityEligible && history.length >= 2 && recoveryEligible.length >= 2;
  const lowTrapRisk = enough && medians.recoverySessions !== null && medians.recoverySessions <= 15 && medians.exDropPercentOfDividend !== null && medians.exDropPercentOfDividend <= 100;
  return {
    asOf, close: latest.close, priceHistoryFrom: bars[0].date, averageValue20, liquidityEligible, history, projections,
    yield: { trailing: trailingYield, ahead: aheadYield, selected: selectedYield }, medians, recoveredWithin15Rate,
    patterns: {
      lowTrapRisk,
      capture: lowTrapRisk && recoveredWithin15Rate !== null && recoveredWithin15Rate >= 2 / 3 && selectedYield !== null && selectedYield >= 0.03,
      runUp: enough && !lowTrapRisk && medians.runUpPercent !== null && medians.runUpPercent > 0 && selectedYield !== null && selectedYield >= 0.05,
      highYield: enough && selectedYield !== null && selectedYield > 0.07,
    },
  };
}
