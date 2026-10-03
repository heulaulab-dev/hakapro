import { describe, expect, test } from "vitest";
import { fixture } from "../../../tests/support/fixtures";
import { parseProviderNumber } from "./parse-number";

const ok = (input: string, options: Parameters<typeof parseProviderNumber>[1]) => {
  const result = parseProviderNumber(input, options);
  if (!result.ok) throw new Error(`${input}: ${result.reason}`);
  return result.quantity;
};

describe("real provider strings (fixtures/arjum)", () => {
  test('analysis "−57M lembar" uses English scale: −57 million shares', () => {
    // From analysis.json: "**Net Jual** −57M lembar"; history.json n_foreign for that day is -56,761,900.
    expect(ok("−57M lembar", { unit: "shares", separators: "en", scale: "en" })).toEqual({ value: -57_000_000, unit: "shares" });
    const history = fixture<{ rows: Array<{ date: string; n_foreign: number }> }>("history");
    expect(Math.round(history.rows[0].n_foreign / 1e6)).toBe(-57);
  });

  test('market-cap "122.04M" listed shares uses Indonesian scale: 122.04 miliar', () => {
    const row = fixture<{ data: Array<{ listed_shares: number; listed_shares_label: string; market_cap: number; market_cap_label: string }> }>("market-cap").data[0];
    const shares = ok(row.listed_shares_label, { unit: "shares", separators: "en", scale: "id" });
    expect(shares.value).toBeCloseTo(122.04e9, -7);
    expect(Math.abs(shares.value - row.listed_shares) / row.listed_shares).toBeLessThan(0.0001);
    const cap = ok(row.market_cap_label, { unit: "idr", separators: "en", scale: "id" });
    expect(Math.abs(cap.value - row.market_cap) / row.market_cap).toBeLessThan(0.0001);
  });

  test("the same label read with the wrong convention is off by 1000×, which is why scale is mandatory", () => {
    const wrong = ok("122.04M", { unit: "shares", separators: "en", scale: "en" });
    expect(wrong.value).toBeCloseTo(122.04e6, -4);
    expect(parseProviderNumber("122.04M", { unit: "shares", separators: "en" })).toMatchObject({ ok: false });
  });

  test("insider holdings, percentages and price", () => {
    const row = fixture<{ items: Array<Record<string, string>> }>("insiders").items[0];
    expect(ok(row.previous_value, { unit: "shares", separators: "en" }).value).toBe(7_502_058);
    expect(ok(row.changes_value, { unit: "shares", separators: "en" }).value).toBe(317_892);
    expect(ok(row.price_formatted, { unit: "idr", separators: "en" }).value).toBe(6_982);
    // Percent units: 7,502,058 of ~122.04B listed shares ≈ 0.0061%.
    expect(ok(row.previous_percentage, { unit: "percent", separators: "en" }).value).toBe(0.0061);
    expect(ok(row.changes_percentage, { unit: "percent", separators: "en" }).value).toBe(0.0002);
    expect((7_502_058 / 122_042_299_500) * 100).toBeCloseTo(0.0061, 4);
  });

  test('market-cap "0.145%" turnover label', () => {
    expect(ok("0.145%", { unit: "percent", separators: "en" }).value).toBe(0.145);
  });

  test('analysis currency "Rp6.300" uses Indonesian separators and "−Rp50" a leading sign', () => {
    expect(ok("Rp6.300", { unit: "idr", separators: "id" }).value).toBe(6300);
    expect(ok("−Rp50", { unit: "idr", separators: "id" }).value).toBe(-50);
    expect(ok("Rp193.33B", { unit: "idr", separators: "en", scale: "en" }).value).toBeCloseTo(193.33e9, -5);
  });
});

describe("rejections are explicit, never guesses", () => {
  test.each([
    ["", "empty"],
    ["abc", "abbreviation"],
    ["1,2,3", "formatted"],
    ["12.5X", "unknown abbreviation"],
    ["-57M lembar", "unit mismatch"],
    ["6.98.2", "formatted"],
  ])("%j", (input, reason) => {
    const options = input === "-57M lembar" ? { unit: "idr" as const, separators: "en" as const, scale: "en" as const }
      : input === "6.98.2" ? { unit: "idr" as const, separators: "id" as const }
      : input === "12.5X" ? { unit: "count" as const, separators: "en" as const, scale: "en" as const }
      : { unit: "count" as const, separators: "en" as const };
    const result = parseProviderNumber(input, options);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(reason);
  });
});
