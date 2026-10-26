// /v1/groups: curated conglomerate groups (src/groups/groups.ts) measured over a session window. Measured facts only:
// price change, traded value, breadth, an estimate of net foreign value, and whether price and foreign flow disagree.
// No phase or action label is derived here, by design (a strong price day must never be called "accumulation" while
// foreign investors sell).
//
//   1D   The same rows as /v1/market and /v1/sectors (currentRows): the newest EOD session, or the intraday snapshot
//        when it is from a newer session (DELAYED, and then without foreign data, which only arrives with EOD rows).
//   5D, 20D  The newest 5 / 20 stored EOD sessions (market-wide session dates). A member's change is its last close in
//        the window over the close before the window. A split (or other price-adjusting action) with an ex-date in the
//        window would make that a fake move, so such a member's change is left out of the group's figures and flagged.
//   Foreign  Σ (foreignBuy − foreignSell) × close per session, in IDR: an estimate (the session close, not the trade
//        prices). Only members with foreign data on every session they traded in the window count towards the group's
//        estimate; partially covered members are counted separately and left out.
//   Divergence  The group's price change (value-weighted; the mean when no value traded) and its foreign estimate have
//        opposite non-zero signs. The same rule per member.
import type { z } from "zod";
import type { GroupWindow, groupDivergenceSchema, groupsSchema } from "@/server/schemas/idx-bei";
import type { GroupCatalog, GroupConfidence } from "../groups/catalog";
import { GROUP_CATALOG } from "../groups/groups";
import { wibDateOf } from "../sources/session";
import { currentRows, sessionFreshness, type Served } from "./market";
import type { DailyRecord, MarketStore } from "./store";

export const WINDOW_SESSIONS: Record<GroupWindow, number> = { "1D": 1, "5D": 5, "20D": 20 };
/** Action types whose ex-date changes the price level (dividends do not, at this precision). */
const PRICE_ADJUSTING = /SPLIT|RIGHT|BONUS|CONSOLIDAT/i;

type Groups = z.input<typeof groupsSchema>;
type Divergence = z.infer<typeof groupDivergenceSchema>;

/** Per-member figures over the window, before grouping. */
type MemberStat = {
  symbol: string; close: number | null; changePercent: number | null; value: number | null; sessions: number;
  corporateAction: boolean; netForeign: number | null; foreignSessions: number;
};

export function divergenceOf(change: number | null, netForeign: number | null): Divergence {
  if (change === null || netForeign === null || change === 0 || netForeign === 0) return null;
  if (change > 0 && netForeign < 0) return "price_up_foreign_net_sell";
  if (change < 0 && netForeign > 0) return "price_down_foreign_net_buy";
  return null;
}

const foreignOf = (rows: Array<{ close: number | null; foreignBuy?: number | null; foreignSell?: number | null }>) => {
  let net = 0;
  let sessions = 0;
  for (const row of rows) {
    if (row.close === null || row.foreignBuy == null || row.foreignSell == null) continue;
    net += (row.foreignBuy - row.foreignSell) * row.close;
    sessions += 1;
  }
  return { netForeign: sessions ? net : null, foreignSessions: sessions };
};

/** Members' figures over the last `sessions` EOD sessions up to `endDate`. */
export function windowStats(rows: DailyRecord[], dates: string[], basesBefore: Map<string, number>, adjusted: Set<string>): Map<string, MemberStat> {
  const from = dates.at(-1)!;
  const bySymbol = new Map<string, DailyRecord[]>();
  for (const row of rows) bySymbol.set(row.symbol, [...(bySymbol.get(row.symbol) ?? []), row]);
  const stats = new Map<string, MemberStat>();
  for (const [symbol, history] of bySymbol) {
    history.sort((a, b) => a.date.localeCompare(b.date));
    const first = history[0];
    const last = history.at(-1)!;
    // The close before the window: the first session's previous close when the stock traded on the window's first
    // day, otherwise its last close before the window.
    const base = (first.date === from ? first.previousClose : null) ?? basesBefore.get(symbol) ?? first.previousClose ?? null;
    const corporateAction = adjusted.has(symbol);
    stats.set(symbol, {
      symbol, close: last.close, sessions: history.length, corporateAction,
      changePercent: corporateAction || !base ? null : last.close / base - 1,
      value: history.some((row) => row.value !== null) ? history.reduce((sum, row) => sum + (row.value ?? 0), 0) : null,
      ...foreignOf(history),
    });
  }
  return stats;
}

/** Groups the members' figures. Groups are ranked by value-weighted change (then mean), groups without data last. */
export function groupStats(catalog: GroupCatalog, stats: Map<string, MemberStat>, known: Map<string, { name: string; active: boolean }>): Groups["groups"] {
  const groups = catalog.groups.map((group) => {
    const unknownSymbols: string[] = [];
    const inactiveSymbols: string[] = [];
    const noDataSymbols: string[] = [];
    const stocks: Groups["groups"][number]["stocks"] = [];
    for (const member of group.members) {
      const security = known.get(member.symbol);
      const stat = stats.get(member.symbol);
      if (!security) unknownSymbols.push(member.symbol);
      else if (!security.active && !stat) inactiveSymbols.push(member.symbol);
      if (!stat) {
        if (security?.active) noDataSymbols.push(member.symbol);
        continue;
      }
      const confidence: GroupConfidence = member.confidence ?? group.confidence;
      stocks.push({
        symbol: member.symbol, name: security?.name ?? null, confidence, note: member.note ?? null,
        close: stat.close, changePercent: stat.changePercent, value: stat.value, sessions: stat.sessions, corporateAction: stat.corporateAction,
        netForeignValueEstimate: stat.netForeign, foreignSessions: stat.foreignSessions, divergence: divergenceOf(stat.changePercent, stat.netForeign),
      });
    }
    const priced = stocks.filter((stock) => stock.changePercent !== null);
    const changes = priced.map((stock) => stock.changePercent!);
    const value = stocks.reduce((sum, stock) => sum + (stock.value ?? 0), 0);
    const pricedValue = priced.reduce((sum, stock) => sum + (stock.value ?? 0), 0);
    const valueWeighted = pricedValue > 0 ? priced.reduce((sum, stock) => sum + stock.changePercent! * (stock.value ?? 0), 0) / pricedValue : null;
    const mean = changes.length ? changes.reduce((sum, change) => sum + change, 0) / changes.length : null;
    const complete = stocks.filter((stock) => stock.sessions > 0 && stock.foreignSessions === stock.sessions);
    const partial = stocks.filter((stock) => stock.foreignSessions > 0 && stock.foreignSessions < stock.sessions);
    const netValueEstimate = complete.length ? complete.reduce((sum, stock) => sum + stock.netForeignValueEstimate!, 0) : null;
    const sorted = [...priced].sort((a, b) => b.changePercent! - a.changePercent!);
    return {
      id: group.id, name: group.name, confidence: group.confidence, note: group.note ?? null, reviewedAt: group.reviewedAt, sources: group.sources,
      members: group.members.length, membersWithData: stocks.length, unknownSymbols, inactiveSymbols, noDataSymbols,
      advancers: changes.filter((change) => change > 0).length, decliners: changes.filter((change) => change < 0).length, unchanged: changes.filter((change) => change === 0).length,
      changePercent: mean, valueWeightedChangePercent: valueWeighted, value,
      foreign: { netValueEstimate, members: complete.length, partialMembers: partial.length },
      divergence: divergenceOf(valueWeighted ?? mean, netValueEstimate),
      best: sorted.length ? { symbol: sorted[0].symbol, changePercent: sorted[0].changePercent! } : null,
      worst: sorted.length ? { symbol: sorted.at(-1)!.symbol, changePercent: sorted.at(-1)!.changePercent! } : null,
      stocks: stocks.sort((a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity) || a.symbol.localeCompare(b.symbol)),
    };
  });
  // Tier 0: value-weighted change; 1: only a mean (nothing traded); 2: no data. Best first within a tier.
  const tier = (group: (typeof groups)[number]) => (group.valueWeightedChangePercent !== null ? 0 : group.changePercent !== null ? 1 : 2);
  const score = (group: (typeof groups)[number]) => group.valueWeightedChangePercent ?? group.changePercent ?? 0;
  return groups.sort((a, b) => tier(a) - tier(b) || score(b) - score(a) || a.id.localeCompare(b.id));
}

export async function serveGroups(store: MarketStore, window: GroupWindow, now: Date, catalog: GroupCatalog = GROUP_CATALOG): Promise<Served<Groups> | null> {
  const symbols = [...new Set(catalog.groups.flatMap((group) => group.members.map((member) => member.symbol)))];
  const securities = await store.securities(symbols);
  const known = new Map(securities.map((row) => [row.symbol, { name: row.name, active: row.active !== false }]));
  const catalogMeta = { version: catalog.version, reviewedAt: catalog.reviewedAt };

  if (window === "1D") {
    const current = await currentRows(store, now);
    const wanted = new Set(symbols);
    const stats = new Map<string, MemberStat>();
    for (const row of current.rows) {
      if (!wanted.has(row.symbol)) continue;
      stats.set(row.symbol, {
        symbol: row.symbol, close: row.close, changePercent: row.changePercent, value: row.value, sessions: 1, corporateAction: false, ...foreignOf([row]),
      });
    }
    if (!stats.size || !current.dataAsOf) return null;
    const intraday = current.freshness === "DELAYED";
    const day = intraday ? wibDateOf(new Date(current.dataAsOf)) : current.dataAsOf;
    return {
      data: { window: { id: window, sessions: 1, from: day, to: day, basis: intraday ? "intraday" : "daily" }, catalog: catalogMeta, groups: groupStats(catalog, stats, known) },
      dataAsOf: current.dataAsOf, freshness: current.freshness,
    };
  }

  const endDate = await store.latestSessionDate();
  if (!endDate) return null;
  const dates = await store.sessionDates(endDate, WINDOW_SESSIONS[window]);
  const from = dates.at(-1)!;
  const [rows, basesBefore, actions] = await Promise.all([store.dailyRowsBetween(from, endDate, symbols), store.closesBefore(from, symbols), store.actionsBetween(from, endDate)]);
  if (!rows.length) return null;
  const adjusted = new Set(actions.filter((action) => PRICE_ADJUSTING.test(action.type)).map((action) => action.symbol));
  return {
    data: {
      window: { id: window, sessions: dates.length, from, to: endDate, basis: "daily" }, catalog: catalogMeta,
      groups: groupStats(catalog, windowStats(rows, dates, basesBefore, adjusted), known),
    },
    dataAsOf: endDate, freshness: sessionFreshness(endDate, now),
  };
}
