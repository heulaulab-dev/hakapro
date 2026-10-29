// Unit-level checks of the securities upsert (the SQL it renders); the real-database round trip is in test/e2e-sources.
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { securityConflictSet, securityValues } from "./ingest";

const render = (fragment: SQL) => new PgDialect().sqlToQuery(fragment).sql;
const prov = { source: "pasardana", asOf: new Date("2026-10-16T09:00:00Z"), rawRef: null };

describe("securities upsert", () => {
  it("inserts a missing logo id as null and a given one as is", () => {
    expect(securityValues({ symbol: "AADI", name: "Adaro" }, prov).logoId).toBeNull();
    expect(securityValues({ symbol: "BBCA", name: "BCA", logoId: "bank-central-asia" }, { ...prov, source: "tradingview-scanner" }).logoId).toBe("bank-central-asia");
  });

  it("keeps the stored logo id when the incoming row has none (coalesce keep-pattern)", () => {
    const set = securityConflictSet();
    expect(render(set.logoId)).toBe('coalesce(excluded."logo_id", "securities"."logo_id")');
    // Same rule as the other source-specific columns.
    expect(render(set.freeFloatPct)).toBe('coalesce(excluded."free_float_pct", "securities"."free_float_pct")');
  });
});
