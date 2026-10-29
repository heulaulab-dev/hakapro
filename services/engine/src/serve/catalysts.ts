import type { z } from "zod";
import type { catalystsSchema } from "@/server/schemas/market-intelligence";
import type { MarketStore } from "./store";
import type { Served } from "./market";

type CatalystPayload = z.input<typeof catalystsSchema>;
type Event = CatalystPayload["events"][number];

const freshness = (asOf: string | null, now: Date): Event["freshness"] => {
  if (!asOf) return "UNAVAILABLE";
  const age = now.getTime() - new Date(asOf).getTime();
  if (age <= 2 * 86_400_000) return "EOD";
  if (age <= 14 * 86_400_000) return "STALE";
  return "HISTORICAL";
};

export async function serveCatalysts(store: MarketStore, symbol: string, now: Date): Promise<Served<CatalystPayload>> {
  const [news, actions, profile, fundamentals, ratios, ownershipRows] = await Promise.all([
    store.news({ symbol, offset: 0, limit: 8 }), store.actions(symbol), store.issuerProfile(symbol), store.fundamentals(symbol),
    store.ratios([symbol]), store.dailyHistory(symbol, 3),
  ]);
  const events: Event[] = [];
  for (const row of news) events.push({ kind: "NEWS", headline: row.title, detail: row.outlet, occurredAt: row.publishedAt.toISOString(), source: row.outlet, asOf: row.publishedAt.toISOString(), freshness: row.publishedAtEstimated ? "STALE" : freshness(row.publishedAt.toISOString(), now), confidence: row.publishedAtEstimated ? "medium" : "high" });
  for (const row of actions) if (row.exDate) events.push({ kind: "ACTION", headline: row.type, detail: row.description, occurredAt: row.exDate, source: "corporate-actions", asOf: row.asOf.toISOString(), freshness: freshness(row.asOf.toISOString(), now), confidence: "medium" });
  if (profile) events.push({ kind: "PROFILE", headline: `${profile.symbol} issuer profile`, detail: profile.profile["KegiatanUsahaUtama"]?.toString() ?? null, occurredAt: profile.retrievedAt.toISOString(), source: profile.source ?? "idx-bei-api", asOf: profile.asOf?.toISOString() ?? profile.retrievedAt.toISOString(), freshness: freshness((profile.asOf ?? profile.retrievedAt).toISOString(), now), confidence: "high" });
  const latestFundamental = fundamentals.sort((a, b) => b.periodEnd.localeCompare(a.periodEnd))[0];
  if (latestFundamental) events.push({ kind: "FUNDAMENTAL", headline: `${latestFundamental.periodType.toUpperCase()} financials available`, detail: latestFundamental.periodEnd, occurredAt: latestFundamental.periodEnd, source: latestFundamental.source, asOf: latestFundamental.periodEnd, freshness: freshness(latestFundamental.periodEnd, now), confidence: "medium" });
  const latestRatio = ratios.sort((a, b) => b.date.localeCompare(a.date))[0];
  if (latestRatio) events.push({ kind: "FUNDAMENTAL", headline: `${latestRatio.ratio.toUpperCase()} ${latestRatio.value ?? "n/a"}`, detail: latestRatio.ratioSource, occurredAt: latestRatio.date, source: latestRatio.ratioSource, asOf: latestRatio.date, freshness: freshness(latestRatio.date, now), confidence: latestRatio.ratioSource === "derived" ? "medium" : "low" });
  const latest = ownershipRows.at(-1);
  if (latest?.foreignBuy !== null && latest?.foreignBuy !== undefined && latest.foreignSell !== null && latest.foreignSell !== undefined) events.push({ kind: "FLOW", headline: "Foreign flow recorded", detail: `Buy ${latest.foreignBuy.toLocaleString()} / sell ${latest.foreignSell.toLocaleString()} shares`, occurredAt: latest.date, source: "arjum", asOf: latest.date, freshness: freshness(latest.date, now), confidence: "low" });
  events.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  return { data: { symbol, events: events.slice(0, 20), available: events.length > 0 }, dataAsOf: events[0]?.asOf ?? null, freshness: events.length ? events[0].freshness : "UNAVAILABLE" };
}
