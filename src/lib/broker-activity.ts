import type { MarketBrokerSummary } from "@/lib/api/market";

export const BROKER_ACTIVITY_WINDOWS = ["1M", "3M", "6M", "1Y"] as const;
export type BrokerActivityWindow = (typeof BROKER_ACTIVITY_WINDOWS)[number];

const WINDOW_DAYS: Record<BrokerActivityWindow, number> = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365 };

export function brokerActivityRange(window: BrokerActivityWindow, today: string): { from: string; to: string } {
  const date = new Date(`${today}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== today) throw new Error("today must be a valid YYYY-MM-DD date");
  date.setUTCDate(date.getUTCDate() - WINDOW_DAYS[window] + 1);
  return { from: date.toISOString().slice(0, 10), to: today };
}

export type BrokerActivityRow = { code: string; name: string | null; value: number | null; volume: number | null; frequency: number | null; sharePercent: number | null };
export type BrokerActivityModel = {
  expectedDates: string[];
  reportedSessions: number | null;
  missingDates: string[];
  latestDate: string | null;
  rows: BrokerActivityRow[];
  raceCodes: Array<{ code: string; name: string | null }>;
  race: Array<{ date: string; shares: Array<number | null> }>;
  concentration: Array<{ date: string; topFiveSharePercent: number | null; hhi: number | null }>;
  latestTopFiveSharePercent: number | null;
  latestHhi: number | null;
  latestConcentrationComplete: boolean;
  coverageKnown: boolean;
};

export function deriveBrokerActivity(data: MarketBrokerSummary): BrokerActivityModel {
  const byDate = new Map(data.dates.map((item) => [item.date, item]));
  const expectedDates = data.coverage?.expectedDates ?? data.dates.map((item) => item.date);
  const totals = new Map<string, { code: string; name: string | null; value: number }>();

  for (const item of data.dates) {
    for (const broker of item.brokers) {
      const current = totals.get(broker.code) ?? { code: broker.code, name: broker.name, value: 0 };
      if (broker.value !== null) current.value += broker.value;
      if (broker.name) current.name = broker.name;
      totals.set(broker.code, current);
    }
  }

  const raceCodes = [...totals.values()].sort((a, b) => b.value - a.value || a.code.localeCompare(b.code)).slice(0, 6).map(({ code, name }) => ({ code, name }));
  const race = expectedDates.map((date) => {
    const summary = byDate.get(date);
    const rowCount = summary?.rowCount ?? summary?.brokers.length ?? 0;
    const completeRows = Boolean(summary && rowCount === summary.brokers.length && rowCount < 100 && summary.brokers.every((broker) => broker.value !== null));
    const denominator = completeRows && summary ? summary.brokers.reduce((sum, broker) => sum + broker.value!, 0) : 0;
    const rowByCode = new Map(summary?.brokers.map((broker) => [broker.code, broker.value]) ?? []);
    return { date, shares: raceCodes.map(({ code }) => denominator > 0 && rowByCode.get(code) !== null && rowByCode.get(code) !== undefined ? (rowByCode.get(code)! / denominator) * 100 : null) };
  });

  const concentration = expectedDates.map((date) => {
    const summary = byDate.get(date);
    const allValuesPresent = summary?.brokers.every((broker) => broker.value !== null) ?? false;
    const denominator = allValuesPresent && summary ? summary.brokers.reduce((sum, broker) => sum + broker.value!, 0) : 0;
    const rawCount = summary?.rowCount ?? summary?.brokers.length ?? 0;
    const complete = Boolean(summary && allValuesPresent && rawCount === summary.brokers.length && rawCount < 100 && denominator > 0);
    if (!complete || !summary) return { date, topFiveSharePercent: null, hhi: null };
    const ranked = [...summary.brokers].sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
    const shares = ranked.map((broker) => broker.value! / denominator);
    return {
      date,
      topFiveSharePercent: shares.slice(0, 5).reduce((sum, share) => sum + share, 0) * 100,
      hhi: shares.reduce((sum, share) => sum + share ** 2, 0) * 10_000,
    };
  });

  const latestDate = [...data.dates].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date ?? null;
  const rows = latestDate ? (byDate.get(latestDate)?.brokers ?? []).map((broker) => {
    const latest = byDate.get(latestDate)!;
    const rawCount = latest.rowCount ?? latest.brokers.length;
    const completeRows = rawCount === latest.brokers.length && rawCount < 100 && latest.brokers.every((row) => row.value !== null);
    const denominator = completeRows ? latest.brokers.reduce((sum, row) => sum + row.value!, 0) : 0;
    return { code: broker.code, name: broker.name, value: broker.value, volume: broker.volume, frequency: broker.frequency, sharePercent: denominator > 0 && broker.value !== null ? (broker.value / denominator) * 100 : null };
  }).sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.code.localeCompare(b.code)) : [];
  const latestConcentration = concentration.find((item) => item.date === latestDate);

  return {
    expectedDates,
    reportedSessions: data.coverage?.reportedSessions ?? null,
    missingDates: data.coverage?.missingDates ?? [],
    latestDate,
    rows,
    raceCodes,
    race,
    concentration,
    latestTopFiveSharePercent: latestConcentration?.topFiveSharePercent ?? null,
    latestHhi: latestConcentration?.hhi ?? null,
    latestConcentrationComplete: latestConcentration?.hhi !== null && latestConcentration?.hhi !== undefined,
    coverageKnown: data.coverage !== undefined,
  };
}
