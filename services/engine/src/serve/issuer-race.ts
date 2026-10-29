import type { z } from "zod";
import type { issuerRaceSchema, issuerRaceWindowSchema } from "@/server/schemas/idx-bei";
import { sessionFreshness, type Served } from "./market";
import type { MarketStore } from "./store";

type IssuerRace = z.input<typeof issuerRaceSchema>;
type Window = z.infer<typeof issuerRaceWindowSchema>;

const WINDOW_SESSIONS: Record<Window, number> = { "1M": 21, "3M": 63, "6M": 126, "1Y": 252 };
const MAX_UNIVERSE = 2500;
const MAX_LEADERS = 12;
const MAX_FRAMES = 52;

/**
 * Build a date-stepped performance race from persisted Engine closes. A shared, exact baseline session prevents
 * newly listed/thinly traded names from being compared over shorter periods. No price is interpolated or carried
 * forward. The payload is bounded to 52 frames × 12 leaders.
 */
export async function serveIssuerRace(store: MarketStore, window: Window, sector: string, now: Date): Promise<Served<IssuerRace> | null> {
  const endDate = await store.latestSessionDate();
  if (!endDate) return null;

  const all = await store.searchSecurities("", MAX_UNIVERSE + 1);
  const truncated = all.length > MAX_UNIVERSE;
  const active = all.slice(0, MAX_UNIVERSE);
  const sectors = [...new Set(active.map((security) => security.sector?.trim()).filter((name): name is string => Boolean(name)))].sort((a, b) => a.localeCompare(b));
  const chosen = sector.toLowerCase() === "all"
    ? active
    : active.filter((security) => security.sector?.trim().toLocaleLowerCase("id-ID") === sector.trim().toLocaleLowerCase("id-ID"));
  const requested = WINDOW_SESSIONS[window];
  const datesNewestFirst = await store.sessionDates(endDate, requested + 1);
  const dates = datesNewestFirst.reverse();
  if (dates.length < 2) {
    return {
      data: { window, sector, sectors, from: dates[0] ?? null, to: dates.at(-1) ?? null, sessions: dates.length, frameStep: 1,
        universe: { active: chosen.length, withBaseline: 0, truncated }, frames: [] },
      dataAsOf: endDate, freshness: sessionFreshness(endDate, now),
    };
  }

  // The oldest date is the common base; the remaining requested sessions are the displayed race timeline.
  const [baseDate, ...timeline] = dates;
  const symbols = chosen.map(({ symbol }) => symbol);
  const rows = await store.dailyRowsBetween(baseDate, endDate, symbols);
  const base = new Map<string, number>();
  const byDate = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.date === baseDate && Number.isFinite(row.close) && row.close > 0) base.set(row.symbol, row.close);
    const bucket = byDate.get(row.date) ?? [];
    bucket.push(row);
    byDate.set(row.date, bucket);
  }

  const step = Math.max(1, Math.ceil(timeline.length / MAX_FRAMES));
  const frameDates = timeline.filter((_, index) => (index + 1) % step === 0);
  if (!frameDates.length || frameDates.at(-1) !== timeline.at(-1)) frameDates.push(timeline.at(-1)!);
  const securityBySymbol = new Map(chosen.map((security) => [security.symbol, security]));
  const frames = frameDates.map((date) => {
    const pricedRows = (byDate.get(date) ?? []).filter((row) => base.has(row.symbol) && Number.isFinite(row.close) && row.close > 0);
    const leaders = pricedRows.map((row) => {
      const security = securityBySymbol.get(row.symbol)!;
      return {
        symbol: row.symbol,
        name: security.name,
        sector: security.sector,
        close: row.close,
        returnPercent: (row.close / base.get(row.symbol)! - 1) * 100,
      };
    }).sort((a, b) => b.returnPercent - a.returnPercent || a.symbol.localeCompare(b.symbol)).slice(0, MAX_LEADERS);
    return { date, priced: pricedRows.length, leaders };
  });

  return {
    data: {
      window, sector, sectors, from: baseDate, to: endDate, sessions: timeline.length, frameStep: step,
      universe: { active: chosen.length, withBaseline: base.size, truncated }, frames,
    },
    dataAsOf: endDate,
    freshness: sessionFreshness(endDate, now),
  };
}
