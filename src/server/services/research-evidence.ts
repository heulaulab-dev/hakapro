/**
 * Pure building blocks of the Research Brief (spec §3.4): session windows, volume and momentum figures,
 * and the counter-evidence rule. Numbers and keys only; the only prose is the bilingual counter-evidence
 * text, built from computed figures and kept neutral (no advice, no verdict labels).
 */
import { calculateSimpleMovingAverage } from "@/lib/indicators";
import { formatDate, formatIdr, formatPercent, formatVolume, type Locale } from "@/lib/format";
import type { HistoryRow, InsiderRow } from "./arjum-normalize";

/** Windows are counted in trading sessions ending at the latest daily session. */
export const WINDOWS = ["1D", "5D", "7D", "14D", "30D"] as const;
export type WindowKey = (typeof WINDOWS)[number];
export const WINDOW_SESSIONS: Record<WindowKey, number> = { "1D": 1, "5D": 5, "7D": 7, "14D": 14, "30D": 30 };

export type SessionWindow = {
  key: WindowKey;
  sessions: number;
  /** First and last session inside the window. */
  start: string;
  end: string;
  /** Close before the window → last close, in percent units. Null when the base close is unusable. */
  priceChangePercent: number | null;
  /** Sum of net foreign shares over the window's sessions. */
  foreignNetShares: number;
  foreignBuySessions: number;
  foreignSellSessions: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Session windows over ascending daily rows. A window needs one extra row (the close before it) so the
 * price change and the foreign flow cover exactly the same sessions; without it the window is null.
 */
export function sessionWindows(rows: HistoryRow[]): Record<WindowKey, SessionWindow | null> {
  const result = {} as Record<WindowKey, SessionWindow | null>;
  for (const key of WINDOWS) {
    const sessions = WINDOW_SESSIONS[key];
    if (rows.length < sessions + 1) { result[key] = null; continue; }
    const inside = rows.slice(-sessions);
    const base = rows[rows.length - sessions - 1];
    const last = rows[rows.length - 1];
    result[key] = {
      key, sessions, start: inside[0].date, end: last.date,
      priceChangePercent: base.close > 0 ? round2(((last.close - base.close) / base.close) * 100) : null,
      foreignNetShares: inside.reduce((sum, row) => sum + row.foreignNetShares, 0),
      foreignBuySessions: inside.filter((row) => row.foreignNetShares > 0).length,
      foreignSellSessions: inside.filter((row) => row.foreignNetShares < 0).length,
    };
  }
  return result;
}

export const BASELINE_SESSIONS = 20;

export type VolumeFacts = {
  session: string;
  volumeShares: number; valueIdr: number; frequency: number;
  baselineSessions: number;
  avgVolumeShares: number; avgValueIdr: number;
  /** Average value per trade (IDR); null without trades. */
  orderSizeIdr: number | null; avgOrderSizeIdr: number | null;
  volumeRatio: number | null; valueRatio: number | null; orderSizeRatio: number | null;
};

/** Latest session against the average of the 20 sessions before it (the latest is not in its own baseline). */
export function volumeFacts(rows: HistoryRow[]): VolumeFacts | null {
  if (rows.length < BASELINE_SESSIONS + 1) return null;
  const latest = rows[rows.length - 1];
  const baseline = rows.slice(-(BASELINE_SESSIONS + 1), -1);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const avgVolumeShares = mean(baseline.map((row) => row.volumeShares));
  const avgValueIdr = mean(baseline.map((row) => row.valueIdr));
  const traded = baseline.filter((row) => row.frequency > 0);
  const avgOrderSizeIdr = traded.length ? mean(traded.map((row) => row.valueIdr / row.frequency)) : null;
  const orderSizeIdr = latest.frequency > 0 ? latest.valueIdr / latest.frequency : null;
  const ratio = (value: number | null, base: number | null) => (value !== null && base !== null && base > 0 ? round2(value / base) : null);
  return {
    session: latest.date, volumeShares: latest.volumeShares, valueIdr: latest.valueIdr, frequency: latest.frequency,
    baselineSessions: baseline.length, avgVolumeShares: Math.round(avgVolumeShares), avgValueIdr: Math.round(avgValueIdr),
    orderSizeIdr: orderSizeIdr === null ? null : Math.round(orderSizeIdr), avgOrderSizeIdr: avgOrderSizeIdr === null ? null : Math.round(avgOrderSizeIdr),
    volumeRatio: ratio(latest.volumeShares, avgVolumeShares), valueRatio: ratio(latest.valueIdr, avgValueIdr), orderSizeRatio: ratio(orderSizeIdr, avgOrderSizeIdr),
  };
}

export type MomentumFacts = { session: string; close: number; sma20: number | null; closeVsSma20: "above" | "below" | "at" | null };

export function momentumFacts(rows: HistoryRow[]): MomentumFacts | null {
  const latest = rows.at(-1);
  if (!latest) return null;
  const sma = calculateSimpleMovingAverage(rows.map((row) => ({ time: row.date, close: row.close })), BASELINE_SESSIONS).at(-1);
  const sma20 = sma && sma.time === latest.date ? round2(sma.value) : null;
  return { session: latest.date, close: latest.close, sma20, closeVsSma20: sma20 === null ? null : latest.close > sma20 ? "above" : latest.close < sma20 ? "below" : "at" };
}

export type InsiderFacts = {
  lookbackDays: number; since: string;
  transactions: number; buys: number; sells: number;
  /** Shares bought minus shares sold in reported BUY/SELL transactions (absolute changes, so the provider's sign convention does not matter). */
  netShares: number;
  latestDate: string | null;
  rows: InsiderRow[];
};

function shiftDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Insider transactions dated within `lookbackDays` calendar days up to and including `asOfDate`. */
export function insiderFacts(rows: InsiderRow[], asOfDate: string, lookbackDays: number): InsiderFacts {
  const since = shiftDays(asOfDate, -lookbackDays);
  const recent = rows.filter((row) => row.date >= since && row.date <= asOfDate).sort((a, b) => b.date.localeCompare(a.date));
  const size = (row: InsiderRow) => Math.abs(row.changeShares ?? 0);
  const buys = recent.filter((row) => row.action === "BUY");
  const sells = recent.filter((row) => row.action === "SELL");
  return {
    lookbackDays, since, transactions: recent.length, buys: buys.length, sells: sells.length,
    netShares: buys.reduce((sum, row) => sum + size(row), 0) - sells.reduce((sum, row) => sum + size(row), 0),
    latestDate: recent[0]?.date ?? null,
    rows: recent,
  };
}

/** Close on the last session on or before `date` → last close, in percent units. */
export function priceChangeSince(rows: HistoryRow[], date: string): { from: string; percent: number } | null {
  const last = rows.at(-1);
  const base = [...rows].reverse().find((row) => row.date <= date);
  if (!last || !base || base === last || base.close <= 0) return null;
  return { from: base.date, percent: round2(((last.close - base.close) / base.close) * 100) };
}

// --- Counter-evidence (spec §3.4 #7, acceptance criterion 4) -------------------------------------

export type CounterEvidence = { key: string; component: "foreign" | "broker" | "insider"; window: string | null; text: { id: string; en: string } };

const sign = (value: number | null | undefined) => (value === null || value === undefined || value === 0 ? 0 : value > 0 ? 1 : -1);

/** Price direction and a flow disagree when both are non-zero and point opposite ways. */
export function disagrees(priceChange: number | null | undefined, flow: number | null | undefined): boolean {
  return sign(priceChange) !== 0 && sign(flow) !== 0 && sign(priceChange) !== sign(flow);
}

const both = (build: (locale: Locale) => string) => ({ id: build("id"), en: build("en") }) as { id: string; en: string };
const absPercent = (value: number, locale: Locale) => formatPercent(Math.abs(value), locale, { signed: false });

function priceClause(locale: Locale, change: number, sessions: number, end: string): string {
  const pct = absPercent(change, locale);
  const date = formatDate(end, locale);
  if (locale === "id") return `Harga ${change > 0 ? "naik" : "turun"} ${pct} dalam ${sessions} sesi hingga ${date}`;
  return `Price ${change > 0 ? "rose" : "fell"} ${pct} over ${sessions} session${sessions === 1 ? "" : "s"} to ${date}`;
}

/**
 * Lists every flow that points the other way from price over the same window: net foreign shares from
 * daily history, the foreign-investor category of the broker summary, and reported insider transactions.
 */
export function counterEvidence(input: {
  windows: Record<WindowKey, SessionWindow | null>;
  brokerForeign?: Partial<Record<WindowKey, { netValueIdr: number; start: string; end: string } | null>>;
  insider?: { facts: InsiderFacts; price: { from: string; percent: number } | null } | null;
}): CounterEvidence[] {
  const items: CounterEvidence[] = [];
  for (const key of WINDOWS) {
    const window = input.windows[key];
    if (!window || window.priceChangePercent === null) continue;
    const change = window.priceChangePercent;
    if (disagrees(change, window.foreignNetShares)) {
      items.push({
        key: `foreign_${key}`, component: "foreign", window: key,
        text: both((locale) => {
          const shares = formatVolume(Math.abs(window.foreignNetShares), locale, { compact: true });
          return locale === "id"
            ? `${priceClause(locale, change, window.sessions, window.end)}, sementara investor asing mencatat ${window.foreignNetShares < 0 ? "jual" : "beli"} bersih ${shares} pada periode yang sama.`
            : `${priceClause(locale, change, window.sessions, window.end)}, while foreign investors were net ${window.foreignNetShares < 0 ? "sellers" : "buyers"} of ${shares} over the same window.`;
        }),
      });
    }
    const broker = input.brokerForeign?.[key];
    // Only when the broker window covers exactly the same sessions as the price change.
    if (broker && broker.start === window.start && broker.end === window.end && disagrees(change, broker.netValueIdr)) {
      items.push({
        key: `broker_foreign_${key}`, component: "broker", window: key,
        text: both((locale) => {
          const value = formatIdr(Math.abs(broker.netValueIdr), locale, { compact: true });
          return locale === "id"
            ? `${priceClause(locale, change, window.sessions, window.end)}, sementara ringkasan broker untuk investor asing menunjukkan ${broker.netValueIdr < 0 ? "jual" : "beli"} bersih ${value}.`
            : `${priceClause(locale, change, window.sessions, window.end)}, while the broker summary for foreign investors shows net ${broker.netValueIdr < 0 ? "selling" : "buying"} of ${value}.`;
        }),
      });
    }
  }
  const insider = input.insider;
  if (insider?.price && disagrees(insider.price.percent, insider.facts.netShares)) {
    const { facts, price } = insider;
    items.push({
      key: "insider", component: "insider", window: `${facts.lookbackDays}d`,
      text: both((locale) => {
        const pct = absPercent(price.percent, locale);
        const shares = formatVolume(Math.abs(facts.netShares), locale, { compact: true });
        const from = formatDate(price.from, locale);
        return locale === "id"
          ? `Harga ${price.percent > 0 ? "naik" : "turun"} ${pct} sejak ${from}, sementara orang dalam melaporkan ${facts.netShares < 0 ? "penjualan" : "pembelian"} bersih ${shares} dalam ${facts.lookbackDays} hari terakhir.`
          : `Price ${price.percent > 0 ? "rose" : "fell"} ${pct} since ${from}, while insiders reported net ${facts.netShares < 0 ? "sales" : "purchases"} of ${shares} in the last ${facts.lookbackDays} days.`;
      }),
    });
  }
  return items;
}
