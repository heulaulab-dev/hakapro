// Ratio formulas against hand-computed cases (see the header of ratios.ts), plus the real BBCA fixture.
import { describe, expect, it } from "vitest";
import { fixture } from "../../test/support";
import { parseFundamentals } from "../sources/yahoo-fundamentals";
import { deriveRatios, latestBalance, shiftMonthEnd, trailing, type FinancialFact, type RatioInput, type RatioKey } from "./ratios";

const q = (periodEnd: string, metric: string, value: number, currency: string | null = "IDR"): FinancialFact => ({ periodEnd, periodType: "quarterly", metric, value, currency });
const a = (periodEnd: string, metric: string, value: number, currency: string | null = "IDR"): FinancialFact => ({ periodEnd, periodType: "annual", metric, value, currency });
const idr = (currency: string) => (currency === "IDR" ? { rate: 1, date: null } : null);

/** A balance sheet at 2026-06-30: equity 500 (parent), 600 with NCI, liabilities 1 200, assets 1 800. */
const balance = (overrides: Partial<Record<"equity" | "totalEquity" | "totalLiabilities" | "totalAssets", number>> = {}) => {
  const values = { equity: 500, totalEquity: 600, totalLiabilities: 1200, totalAssets: 1800, ...overrides };
  return Object.entries(values).map(([metric, value]) => q("2026-06-30", metric, value));
};
/** Net income: four consecutive quarters ending 2026-06-30 (10 + 20 + 30 + 40 = 100). */
const fourQuarters = [q("2025-09-30", "netIncome", 10), q("2025-12-31", "netIncome", 20), q("2026-03-31", "netIncome", 30), q("2026-06-30", "netIncome", 40), a("2025-12-31", "netIncome", 80)];

const run = (overrides: Partial<RatioInput>) => {
  const results = deriveRatios({ priceDate: "2026-10-16", price: 100, shares: 10, facts: [...fourQuarters, ...balance()], fx: idr, dividends: [], ...overrides });
  return Object.fromEntries(results.map((result) => [result.ratio, result])) as Record<RatioKey, (typeof results)[number]>;
};

describe("trailing twelve months", () => {
  it("sums four consecutive quarters", () => {
    expect(trailing(fourQuarters, "netIncome", "2026-10-16")).toMatchObject({ value: 100, basis: "ttm-4q:2026-06-30", periodEnd: "2026-06-30" });
  });

  it("uses last annual + this year's quarters − the same quarters a year earlier when a quarter is missing", () => {
    // Q3-2025 missing (as for BBCA): 100 + (30 + 35) − (20 + 25) = 120.
    const facts = [a("2025-12-31", "netIncome", 100), q("2025-03-31", "netIncome", 20), q("2025-06-30", "netIncome", 25), q("2025-12-31", "netIncome", 28), q("2026-03-31", "netIncome", 30), q("2026-06-30", "netIncome", 35)];
    expect(trailing(facts, "netIncome", "2026-10-16")).toMatchObject({ value: 120, basis: "ttm-ytd:2026-06-30" });
  });

  it("uses the annual value when it is the newest, or when no TTM can be built", () => {
    expect(trailing([a("2025-12-31", "netIncome", 80), q("2025-12-31", "netIncome", 20)], "netIncome", "2026-03-01")).toMatchObject({ value: 80, basis: "annual:2025-12-31" });
    // A newer quarter without its prior-year twin: the annual value, labelled as such.
    expect(trailing([a("2025-12-31", "netIncome", 80), q("2026-03-31", "netIncome", 30)], "netIncome", "2026-05-01")).toMatchObject({ value: 80, basis: "annual:2025-12-31" });
    expect(trailing([q("2026-03-31", "netIncome", 30)], "netIncome", "2026-05-01")).toBeNull();
  });

  it("treats inputs older than ~six quarters as missing and refuses mixed currencies", () => {
    expect(trailing([a("2024-12-31", "netIncome", 80)], "netIncome", "2026-10-16")).toBeNull();
    expect(latestBalance([q("2025-03-31", "equity", 1)], "equity", "2026-10-16")).toBeNull();
    const mixed = [q("2025-09-30", "netIncome", 1, "USD"), q("2025-12-31", "netIncome", 1), q("2026-03-31", "netIncome", 1), q("2026-06-30", "netIncome", 1)];
    expect(trailing(mixed, "netIncome", "2026-10-16")).toBeNull();
  });

  it("steps quarter ends by month ends", () => {
    expect(shiftMonthEnd("2026-03-31", -3)).toBe("2025-12-31");
    expect(shiftMonthEnd("2025-12-31", 3)).toBe("2026-03-31");
    expect(shiftMonthEnd("2026-06-30", -12)).toBe("2025-06-30");
    expect(shiftMonthEnd("2024-02-29", 12)).toBe("2025-02-28");
    expect(shiftMonthEnd("2026-09-30", 3)).toBe("2026-12-31");
  });
});

describe("deriveRatios", () => {
  it("computes every ratio for a profitable company (hand-computed)", () => {
    const dividends = [{ exDate: "2025-11-01", amount: 3 }, { exDate: "2026-05-01", amount: 2 }, { exDate: "2025-10-01", amount: 9 }, { exDate: "2026-10-20", amount: 7 }];
    const r = run({ dividends });
    expect(r.eps).toMatchObject({ status: "ok", value: 10, basis: "ttm-4q:2026-06-30" }); // 100 / 10 shares
    expect(r.per).toMatchObject({ status: "ok", value: 10 }); // 100 / 10
    expect(r.pbv.value).toBeCloseTo(2, 12); // 100 / (500 / 10)
    expect(r.roe.value).toBeCloseTo(0.2, 12); // 100 / 500
    expect(r.roa.value).toBeCloseTo(100 / 1800, 12);
    expect(r.der.value).toBeCloseTo(2, 12); // 1 200 / 600 (equity incl. NCI)
    // Ex-dates in (2025-10-16, 2026-10-16]: 3 + 2; the 2025-10-01 and 2026-10-20 ones are outside.
    expect(r.dividendYield).toMatchObject({ status: "ok", basis: "dividends-365d" });
    expect(r.dividendYield.value).toBeCloseTo(0.05, 12);
    expect(r.per.inputs).toMatchObject({ netIncome: 100, shares: 10, sharesSource: "universe", price: 100, priceDate: "2026-10-16" });
  });

  it("negative equity: PBV, ROE and DER are null (not meaningful), never a negative multiple", () => {
    const r = run({ facts: [...fourQuarters, ...balance({ equity: -50, totalEquity: -40 })] });
    for (const ratio of ["pbv", "roe", "der"] as const) expect(r[ratio]).toMatchObject({ status: "not_meaningful", value: null, note: "NON_POSITIVE_EQUITY" });
    expect(r.per).toMatchObject({ status: "ok", value: 10 });
    expect(r.roa.value).toBeCloseTo(100 / 1800, 12);
  });

  it("zero or negative earnings: PER is null; EPS and ROE keep their sign", () => {
    const zero = run({ facts: [a("2025-12-31", "netIncome", 0), ...balance()], priceDate: "2026-03-01" });
    expect(zero.eps).toMatchObject({ status: "ok", value: 0, basis: "annual:2025-12-31" });
    expect(zero.per).toMatchObject({ status: "not_meaningful", value: null, note: "NON_POSITIVE_EARNINGS" });
    expect(zero.roe).toMatchObject({ status: "ok", value: 0 });

    const loss = run({ facts: [q("2025-09-30", "netIncome", -10), q("2025-12-31", "netIncome", -20), q("2026-03-31", "netIncome", -30), q("2026-06-30", "netIncome", 10), ...balance()] });
    expect(loss.eps).toMatchObject({ status: "ok", value: -5 }); // −50 / 10
    expect(loss.per).toMatchObject({ status: "not_meaningful", value: null, note: "NON_POSITIVE_EARNINGS" });
    expect(loss.roe.value).toBeCloseTo(-0.1, 12);
  });

  it("missing inputs are missing (null), never 0", () => {
    const none = run({ facts: [], dividends: null });
    expect(Object.values(none).every((result) => result.status === "missing" && result.value === null)).toBe(true);
    expect(none.eps.note).toBe("NO_NET_INCOME");

    const noPrice = run({ price: null });
    expect(noPrice.per).toMatchObject({ status: "missing", note: "NO_PRICE" });
    expect(noPrice.pbv).toMatchObject({ status: "missing", note: "NO_PRICE" });
    expect(noPrice.dividendYield).toMatchObject({ status: "missing", note: "NO_PRICE" });
    expect(noPrice.eps.status).toBe("ok"); // EPS doesn't need the price
    expect(noPrice.roe.status).toBe("ok");

    const stale = run({ facts: [a("2023-12-31", "netIncome", 80), ...balance()] });
    expect(stale.eps).toMatchObject({ status: "missing", note: "NO_NET_INCOME" });
  });

  it("falls back to the statements' share count, then has no per-share ratios without one", () => {
    const fromStatements = run({ shares: null, facts: [...fourQuarters, ...balance(), q("2026-06-30", "sharesOutstanding", 20, null)] });
    expect(fromStatements.eps).toMatchObject({ value: 5, inputs: { sharesSource: "balance:2026-06-30" } });
    const none = run({ shares: null });
    expect(none.eps).toMatchObject({ status: "missing", note: "NO_SHARES" });
    expect(none.roe.status).toBe("ok");
  });

  it("converts a USD filer's amounts with JISDOR where they meet the IDR price", () => {
    const usd = (facts: FinancialFact[]) => facts.map((fact) => ({ ...fact, currency: "USD" }));
    const facts = usd([...fourQuarters, ...balance()]);
    const r = run({ facts, price: 1_600_000, fx: (currency) => (currency === "USD" ? { rate: 16_000, date: "2026-10-15" } : null) });
    expect(r.eps).toMatchObject({ value: 160_000, inputs: { fx: 16_000, fxDate: "2026-10-15", currency: "USD" } }); // 100 × 16 000 / 10
    expect(r.per.value).toBeCloseTo(10, 12);
    expect(r.pbv.value).toBeCloseTo(2, 12);
    expect(r.roe.value).toBeCloseTo(0.2, 12); // a same-currency quotient

    const noRate = run({ facts, fx: idr });
    expect(noRate.eps).toMatchObject({ status: "missing", note: "NO_FX_RATE" });
    expect(noRate.pbv).toMatchObject({ status: "missing", note: "NO_FX_RATE" });
    expect(noRate.roe.status).toBe("ok");
  });

  it("dividend yield: a true zero with full price history, the cash-flow fallback without it", () => {
    expect(run({ dividends: [] }).dividendYield).toMatchObject({ status: "ok", value: 0 });
    const cashFlow = run({ dividends: null, facts: [...fourQuarters, ...balance(), a("2025-12-31", "commonDividendsPaid", -50)], priceDate: "2026-03-01" });
    expect(cashFlow.dividendYield).toMatchObject({ status: "ok", basis: "annual:2025-12-31" });
    expect(cashFlow.dividendYield.value).toBeCloseTo(0.05, 12); // 50 / (100 × 10)
    expect(run({ dividends: null }).dividendYield).toMatchObject({ status: "missing", note: "NO_DIVIDEND_DATA" });
  });

  it("derives BBCA from the recorded fixture (ttm-ytd across Yahoo's missing Q3-2025)", () => {
    const facts = parseFundamentals(fixture("yahoo-fundamentals-BBCA.json"), "BBCA.JK").points;
    const results = Object.fromEntries(deriveRatios({ priceDate: "2026-10-16", price: 5225, shares: null, facts, fx: idr, dividends: null }).map((result) => [result.ratio, result]));
    // NI ttm = 57 537 287 + (14 684 123 + 14 850 323) − (14 146 131 + 14 870 283) = 58 055 319 (IDR millions).
    expect(results.eps.basis).toBe("ttm-ytd:2026-06-30");
    expect(results.eps.inputs.netIncome).toBe(58_055_319_000_000);
    expect(results.eps.value).toBeCloseTo(58_055_319_000_000 / 122_841_751_300, 6);
    expect(results.per.value).toBeCloseTo(5225 / (58_055_319_000_000 / 122_841_751_300), 9);
    expect(results.roe.value).toBeCloseTo(58_055_319 / 270_437_543, 12);
    expect(results.der.value).toBeCloseTo(1_389_911_590 / 270_667_746, 12);
  });
});
