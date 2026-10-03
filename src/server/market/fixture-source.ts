import "server-only";
import type { z } from "zod";
import type { Freshness, WithFreshness } from "@/lib/freshness";
import type { RawFetcher } from "@/server/providers/arjum/client";
import { searchResponseSchema } from "@/server/schemas/arjum";
import brokerAccumulation from "../../../fixtures/arjum/broker-accumulation.json";
import brokerSummary from "../../../fixtures/arjum/broker-summary.json";
import doneDetails from "../../../fixtures/arjum/done-details.json";
import financialStatements from "../../../fixtures/arjum/financial-statements.json";
import health from "../../../fixtures/arjum/health.json";
import history from "../../../fixtures/arjum/history.json";
import insiders from "../../../fixtures/arjum/insiders.json";
import marketCap from "../../../fixtures/arjum/market-cap.json";
import screener from "../../../fixtures/arjum/screener.json";
import search from "../../../fixtures/arjum/search.json";
import seasonal from "../../../fixtures/arjum/seasonal.json";
import { ArjumSource, type Clock } from "./arjum-source";
import { MarketDataError } from "./errors";

/** Recorded provider responses (heulatrade tests/fixtures/arjum, captured 2026-09-18). */
const PER_SYMBOL: Record<string, { symbol: string; body: unknown }> = {
  "broker-summary": { symbol: brokerSummary.stock_code, body: brokerSummary },
  "broker-accumulation": { symbol: brokerAccumulation.code, body: brokerAccumulation },
  history: { symbol: history.stock_code, body: history },
  seasonal: { symbol: seasonal.stock_code, body: seasonal },
  "financial-statements": { symbol: financialStatements.stock_code, body: financialStatements },
  insiders: { symbol: insiders.stock_code, body: insiders },
};
const GLOBAL: Record<string, unknown> = {
  "/api/screener/latest": screener,
  "/api/market-cap": marketCap,
  "/api/health": health,
};

export const FIXTURE_SYMBOL = history.stock_code;

const notRecorded = (what: string) => new MarketDataError("NOT_RECORDED", `No recorded fixture for ${what}`, 404);

/**
 * Serves recorded responses through the same schemas and normalizers as the live provider.
 * Data for one symbol is never relabelled as another; unrecorded requests return NOT_RECORDED.
 * Query parameters other than the symbol/search text are not applied.
 */
export const fixtureFetcher: RawFetcher = async <T extends z.ZodType>(path: string, schema: T, query: Record<string, unknown> = {}) => {
  let body: unknown;
  if (path === "/api/search") {
    const q = String(query.q ?? "").trim().toLowerCase();
    body = searchResponseSchema.parse(search).filter((row) => !q || row.stock_code.toLowerCase().startsWith(q) || row._nn.includes(q));
  } else if (path === "/api/done-details") {
    if (String(query.code) !== doneDetails.code) throw notRecorded(`done-details ${String(query.code)}`);
    body = doneDetails;
  } else if (path in GLOBAL) {
    body = GLOBAL[path];
  } else {
    const match = /^\/api\/([a-z-]+)\/([A-Z0-9]+)$/.exec(path);
    const recorded = match ? PER_SYMBOL[match[1]] : undefined;
    if (!match || !recorded) throw notRecorded(path);
    if (recorded.symbol !== match[2]) throw notRecorded(`${match[1]} ${match[2]}`);
    body = recorded.body;
  }
  return schema.parse(body) as z.infer<T>;
};

/**
 * Fixture data is never current: anything the live rules would call LIVE/DELAYED/EOD/STALE is
 * reported as HISTORICAL, and an unknown as-of stays UNAVAILABLE.
 */
export function clampFixtureFreshness(freshness: Freshness, asOf: string | null): Freshness {
  return asOf === null || freshness === "UNAVAILABLE" ? "UNAVAILABLE" : "HISTORICAL";
}

export class FixtureSource extends ArjumSource {
  constructor(clock?: Clock) {
    super(fixtureFetcher, "fixture:arjum", clock);
  }

  protected override wrap<T>(data: T, freshness: Freshness, asOf: string | null, period?: string): WithFreshness<T> {
    return super.wrap(data, clampFixtureFreshness(freshness, asOf), asOf, period);
  }

  // Health of a recorded file says nothing about the provider; keep it explicit.
  override async providerHealth() {
    return this.wrap({ ok: health.ok, status: "fixture" }, "UNAVAILABLE", null);
  }
}
