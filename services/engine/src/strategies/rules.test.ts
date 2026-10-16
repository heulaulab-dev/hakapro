// The draft's synthetic test tables (STRATEGY-RULES v0.1 §4 BREAKOUT, §5 BB REVERSAL), ported case by case, plus the
// gate G rules (§3.3) and the wording rules (§3.5). Every expectation quotes the draft's table.
import { describe, expect, test } from "vitest";
import en from "@/i18n/messages/en.json";
import id from "@/i18n/messages/id.json";
import { ENGINE_CRITERION_KEYS } from "@/lib/strategies/contract";
import { evaluateBbReversal } from "./bb-reversal";
import { evaluateBreakout, type RuleOutcome } from "./breakout";
import { builtStrategies, NOT_BUILT_STRATEGIES } from "./catalog";
import { evaluateGate, type SecurityFacts } from "./gate";
import { bollinger, type Bar } from "./indicators";
import { rowsUsed, STRATEGY_RULES, type StrategyRules } from "./rules";
import { scanUniverse } from "./scan";
import { forbiddenWordingIn } from "./wording";

type Row = [open: number, high: number, low: number, close: number, volume?: number];

/** Consecutive calendar dates ending at 2026-10-15 (t); the rules only look at row order. */
function bars(rows: Row[], volume = 1_000_000): Bar[] {
  const end = Date.parse("2026-10-15T00:00:00Z");
  return rows.map(([open, high, low, close, v], index) => ({
    date: new Date(end - (rows.length - 1 - index) * 86_400_000).toISOString().slice(0, 10),
    open, high, low, close, volume: v ?? volume, value: null,
  }));
}
const SESSION = "2026-10-15";
const security = (overrides: Partial<SecurityFacts> = {}): SecurityFacts => ({ symbol: "TEST", name: "Test Tbk", board: null, notation: null, ...overrides });

function withRules(patch: { gate?: Partial<StrategyRules["gate"]>; breakout?: Partial<StrategyRules["breakout"]>; bbReversal?: Partial<StrategyRules["bbReversal"]> }): StrategyRules {
  return {
    rulesVersion: "test",
    gate: { ...STRATEGY_RULES.gate, ...patch.gate },
    breakout: { ...STRATEGY_RULES.breakout, ...patch.breakout },
    bbReversal: { ...STRATEGY_RULES.bbReversal, ...patch.bbReversal },
  };
}

/** Gate G then one strategy: "match", the gate rule (G1…G8) or the strategy rule (rule1…, inputs) that failed. */
function qualify(rows: Bar[], rules: StrategyRules, strategy: "breakout" | "bb-reversal") {
  const gate = evaluateGate({ session: SESSION, bars: rows, security: security(), splitExDates: [], rowsUsed: rowsUsed(rules) }, rules.gate);
  if (!gate.ok) return { result: gate.rule, outcome: null };
  const outcome: RuleOutcome = strategy === "breakout"
    ? evaluateBreakout(gate.bars, rules.breakout, { averageValueIdr: gate.averageValueIdr })
    : evaluateBbReversal(gate.bars, rules.bbReversal);
  return { result: outcome.matched ? "match" : outcome.failed, outcome, gate };
}
const metric = (outcome: RuleOutcome | null, key: string) => (outcome?.matched ? outcome.metrics.find((m) => m.key === key)?.value : undefined);
const roundTo = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

describe("BREAKOUT (draft §4 test cases: N = 5, RVOL over 5 sessions, minAvgValue Rp 1 bn, other gates off)", () => {
  const rules = withRules({
    gate: { minHistory: 0, minTradedSessions: 0, liquidityLookback: 5, minAverageValueIdr: 1_000_000_000, minPriceIdr: 0, excludeCorporateActions: false },
    breakout: { lookback: 5, relativeVolumeLookback: 5 },
  });
  // Shared base rows D-6..D-1 (O/H/L/C/V).
  const base: Row[] = [
    [1000, 1020, 990, 1010, 1_000_000],
    [1010, 1030, 1000, 1020, 1_100_000],
    [1020, 1040, 1005, 1015, 900_000],
    [1015, 1035, 1000, 1025, 1_000_000],
    [1025, 1040, 1015, 1030, 1_000_000],
    [1030, 1035, 1020, 1030, 1_000_000],
  ];
  const run = (d0: Row, rows: Row[] = base) => qualify(bars([...rows, d0]), rules, "breakout");

  test("shared base: HH_5 = 1040, avgVol_5 = 1,000,000, avgVal_5 ≈ Rp 1.024 bn", () => {
    const { outcome, gate } = run([1035, 1090, 1030, 1080, 3_000_000]);
    expect(metric(outcome, "priorHighIdr")).toBe(1040);
    expect(roundTo(gate!.ok ? gate!.averageValueIdr! / 1e9 : 0, 3)).toBe(1.024);
  });

  test("BO+1 matches: breakout +3.85%, RVOL 3.00, CLV 0.833", () => {
    const { result, outcome } = run([1035, 1090, 1030, 1080, 3_000_000]);
    expect(result).toBe("match");
    expect(roundTo(metric(outcome, "breakoutPercent")!, 2)).toBe(3.85);
    expect(roundTo(metric(outcome, "relativeVolume")!, 2)).toBe(3);
    expect(roundTo(metric(outcome, "closeLocation")!, 3)).toBe(0.833);
    expect(outcome!.matched && outcome!.reasons).toEqual([
      { kind: "criterion", key: "closeAboveHigh" }, { kind: "criterion", key: "relativeVolume" },
      { kind: "criterion", key: "closeLocation" }, { kind: "criterion", key: "firstBreak" },
    ]);
  });

  test("BO−1 low volume: no (rule 2), RVOL 1.20", () => {
    expect(run([1035, 1090, 1030, 1080, 1_200_000]).result).toBe("rule2");
    const loose = qualify(bars([...base, [1035, 1090, 1030, 1080, 1_200_000]]), withRules({ ...rules, breakout: { ...rules.breakout, minRelativeVolume: 1 } }), "breakout");
    expect(roundTo(metric(loose.outcome, "relativeVolume")!, 2)).toBe(1.2);
  });

  test("BO−2 close equals the prior high: no (rule 1: equality is not above), breakout 0.00%", () => {
    expect(run([1035, 1060, 1030, 1040, 3_000_000]).result).toBe("rule1");
  });

  test("BO−3 weak close: no (rule 3), CLV 0.214", () => {
    expect(run([1035, 1100, 1030, 1045, 3_000_000]).result).toBe("rule3");
    const loose = qualify(bars([...base, [1035, 1100, 1030, 1045, 3_000_000]]), withRules({ ...rules, breakout: { ...rules.breakout, minCloseLocation: 0 } }), "breakout");
    expect(roundTo(metric(loose.outcome, "closeLocation")!, 3)).toBe(0.214);
  });

  test("BO−4 not the first break: no (rule 4); D-1 already closed above its HH (1040)", () => {
    const rows: Row[] = [...base.slice(0, 5), [1030, 1060, 1025, 1055, 2_500_000]];
    expect(run([1055, 1090, 1050, 1080, 3_000_000], rows).result).toBe("rule4");
    // Rule 4 is the only one that fails: without it the case matches.
    const loose = qualify(bars([...rows, [1055, 1090, 1050, 1080, 3_000_000]]), withRules({ ...rules, breakout: { ...rules.breakout, requireFirstBreak: false } }), "breakout");
    expect(loose.result).toBe("match");
  });

  test("BO−5 illiquid: all base volumes halved, D0 V 1,500,000 → no (gate G4), avgVal_5 ≈ Rp 0.512 bn", () => {
    const halved = base.map(([o, h, l, c, v]): Row => [o, h, l, c, v! / 2]);
    expect(run([1035, 1090, 1030, 1080, 1_500_000], halved).result).toBe("G4");
    const gate = evaluateGate({ session: SESSION, bars: bars([...halved, [1035, 1090, 1030, 1080, 1_500_000]]), security: security(), splitExDates: [], rowsUsed: 30 }, { ...rules.gate, minAverageValueIdr: 0 });
    expect(gate.ok && roundTo(gate.averageValueIdr! / 1e9, 3)).toBe(0.512);
  });

  test("boundary: RVOL exactly at the threshold qualifies (inclusive ≥, §3.2)", () => {
    expect(run([1035, 1090, 1030, 1080, 2_000_000]).result).toBe("match");
    expect(run([1035, 1090, 1030, 1080, 1_999_999]).result).toBe("rule2");
  });

  test("needs N + 2 rows (§4 Inputs)", () => {
    expect(qualify(bars([...base.slice(1), [1035, 1090, 1030, 1080, 3_000_000]]), rules, "breakout").result).toBe("inputs");
  });

  test("the optional base-range rule (Q-BO2, off by default) applies when set", () => {
    // Prior range (1040 − 1000) / 1000 = 4%.
    const withBase = (max: number) => qualify(bars([...base, [1035, 1090, 1030, 1080, 3_000_000]]), withRules({ ...rules, breakout: { ...rules.breakout, maxBaseRangePercent: max } }), "breakout").result;
    expect(withBase(4)).toBe("match");
    expect(withBase(3.9)).toBe("rule5");
  });
});

describe("BB REVERSAL (draft §5 test cases: period = 10, k = 2, W = 3, minBandwidthPercent 4)", () => {
  // The draft gives no volumes for these tables: constant 1,000,000 shares, liquidity and other gates off.
  const rules = withRules({
    gate: { minHistory: 0, minTradedSessions: 0, minAverageValueIdr: 0, minPriceIdr: 0, excludeCorporateActions: false },
    bbReversal: { period: 10, stdDevs: 2, pierceWindow: 3, minBandwidthPercent: 4 },
  });
  // Shared rows D-12..D-2 (O/H/L/C).
  const shared: Row[] = [
    [1000, 1005, 995, 1000], [1000, 1006, 996, 1002], [1002, 1006, 997, 1000], [1000, 1004, 994, 998],
    [998, 1004, 995, 1001], [1001, 1005, 996, 999], [999, 1003, 994, 997], [997, 1001, 992, 995],
    [995, 999, 990, 994], [994, 996, 988, 992], [992, 994, 986, 990],
  ];
  const pierce: Row = [988, 988, 935, 940];
  // §5 Inputs asks for ≥ period + W + 1 = 14 rows, but the draft's table has 13 (D-12..D0). One flat leading row
  // (D-13) satisfies the input rule without entering any band the cases compute (the earliest band, at t−3, starts at D-12).
  const lead: Row = [1000, 1005, 995, 1000];
  const run = (d0: Row, rows: Row[] = [lead, ...shared, pierce]) => qualify(bars([...rows, d0]), rules, "bb-reversal");
  const bandsAt = (rows: Row[]) => {
    const closes = rows.map((row) => row[3]);
    return bollinger(closes, closes.length - 1, 10, 2)!;
  };

  test("pierce row D-1 = 988/988/935/940: its own lower band 956.2, bandwidth 6.94%", () => {
    const bands = bandsAt([...shared, pierce]);
    expect(roundTo(bands.lower, 1)).toBe(956.2);
    expect(roundTo(bands.bandwidthPercent, 2)).toBe(6.94);
  });

  test("BB+1 matches: bands at D0 949.2 / 986.8 / 1024.4, %B 0.171", () => {
    const { result, outcome } = run([942, 965, 940, 962]);
    expect(result).toBe("match");
    expect([metric(outcome, "lowerBandIdr"), metric(outcome, "middleBandIdr"), metric(outcome, "upperBandIdr")].map((v) => roundTo(v!, 1))).toEqual([949.2, 986.8, 1024.4]);
    expect(roundTo(metric(outcome, "percentB")!, 3)).toBe(0.171);
    expect(metric(outcome, "sessionsSincePierce")).toBe(1);
    expect(roundTo(metric(outcome, "pierceLowerBandIdr")!, 1)).toBe(956.2);
    expect(outcome!.matched && outcome!.notes[0]).toContain("on 2026-10-14");
  });

  test("BB+1 on exactly the draft's 13 rows fails the draft's own input rule (period + W + 1 = 14): inconsistency kept, not fixed", () => {
    expect(run([942, 965, 940, 962], [...shared, pierce]).result).toBe("inputs");
  });

  test("BB−1 still below: no (rule 3), bands 934.4 / 983.6 / 1032.8, %B −0.045", () => {
    const d0: Row = [940, 944, 925, 930];
    expect(run(d0).result).toBe("rule3");
    const bands = bandsAt([...shared, pierce, d0]);
    expect([bands.lower, bands.middle, bands.upper].map((v) => roundTo(v, 1))).toEqual([934.4, 983.6, 1032.8]);
    expect(roundTo((930 - bands.lower) / (bands.upper - bands.lower), 3)).toBe(-0.045);
  });

  test("BB−2 bearish candle: no (rule 5), bands 946.4 / 986.1 / 1025.8, %B 0.108", () => {
    const d0: Row = [970, 972, 950, 955];
    expect(run(d0).result).toBe("rule5");
    const bands = bandsAt([...shared, pierce, d0]);
    expect([bands.lower, bands.middle, bands.upper].map((v) => roundTo(v, 1))).toEqual([946.4, 986.1, 1025.8]);
    expect(roundTo((955 - bands.lower) / (bands.upper - bands.lower), 3)).toBe(0.108);
  });

  test("BB−4 narrow band: D-1 = 990/992/980/984 pierces 985.1 → no (rule 2: bandwidth 1.99% < 4%); without rule 2 it matches", () => {
    const narrow: Row = [990, 992, 980, 984];
    const d0: Row = [984, 992, 983, 990];
    const bands = bandsAt([...shared, narrow]);
    expect(roundTo(bands.lower, 1)).toBe(985.1);
    expect(roundTo(bands.bandwidthPercent, 2)).toBe(1.99);
    expect(run(d0, [lead, ...shared, narrow]).result).toBe("rule2");
    const loose = qualify(bars([lead, ...shared, narrow, d0]), withRules({ ...rules, bbReversal: { ...rules.bbReversal, minBandwidthPercent: 0 } }), "bb-reversal");
    expect(loose.result).toBe("match");
  });

  test("BB−5 pierce too old: the D-1 drop moved to D-4, then closes 948, 950, 951 and D0 = 951/962/950/960 → no (rule 1)", () => {
    // The draft gives only the closes of D-3..D-1; their O/H/L are filled in consistently around those closes.
    const rows: Row[] = [lead, ...shared, pierce, [942, 950, 938, 948], [948, 953, 945, 950], [950, 954, 947, 951]];
    expect(run([951, 962, 950, 960], rows).result).toBe("rule1");
    // With W = 4 the D-4 pierce is inside the window again.
    const wider = qualify(bars([...rows, [951, 962, 950, 960]]), withRules({ ...rules, bbReversal: { ...rules.bbReversal, pierceWindow: 4 } }), "bb-reversal");
    expect(wider.result).toBe("match");
  });

  test("pierce by intraday low (Q-BB2) is stricter only in what counts as a pierce", () => {
    const low = withRules({ ...rules, bbReversal: { ...rules.bbReversal, pierceBasis: "low" } });
    expect(qualify(bars([lead, ...shared, pierce, [942, 965, 940, 962]]), low, "bb-reversal").result).toBe("match");
  });

  test("the draft's note holds: with period 5 and k = 2 a close can never fall strictly below its own band", () => {
    // The most extreme 5-sample case. With the draft's population σ the bound is z = √(n − 1) = 2 exactly (the draft's
    // "1.79" is the sample-σ bound (n − 1)/√n), so the close can at most touch the band, never fall below it.
    const closes = [1000, 1000, 1000, 1000, 1];
    const bands = bollinger(closes, 4, 5, 2)!;
    const sigma = (bands.middle - bands.lower) / 2;
    expect((bands.middle - 1) / sigma).toBeCloseTo(2, 9);
    expect(1 - bands.lower).toBeGreaterThan(-1e-9);
  });
});

describe("gate G (§3.3) at the draft's defaults", () => {
  // 60 liquid, consistent sessions ending on t.
  const healthy = (count = 60): Bar[] => bars(Array.from({ length: count }, (): Row => [1000, 1010, 990, 1000, 2_000_000]));
  const gate = (rows: Bar[], overrides: { security?: Partial<SecurityFacts>; splitExDates?: string[]; session?: string } = {}) =>
    evaluateGate({ session: overrides.session ?? SESSION, bars: rows, security: security(overrides.security), splitExDates: overrides.splitExDates ?? [], rowsUsed: rowsUsed(STRATEGY_RULES) }, STRATEGY_RULES.gate);
  const ruleOf = (result: ReturnType<typeof gate>) => (result.ok ? "pass" : result.rule);

  test("a healthy symbol passes with boardKnown false (no source reports board or notation)", () => {
    const result = gate(healthy());
    expect(result).toMatchObject({ ok: true, boardKnown: false, averageValueIdr: 2_000_000_000, valueEstimatedSessions: 20 });
    expect(gate(healthy(), { security: { board: "Utama", notation: "" } })).toMatchObject({ ok: true, boardKnown: true });
  });

  test("G1: no row for t (suspension, no trade, stale) or V = 0 on t", () => {
    expect(ruleOf(gate(healthy(), { session: "2026-10-16" }))).toBe("G1");
    const rows = healthy();
    rows[rows.length - 1] = { ...rows[rows.length - 1], volume: 0 };
    expect(ruleOf(gate(rows))).toBe("G1");
    expect(ruleOf(gate([]))).toBe("G1");
  });

  test("G2: at least 60 sessions of history (the IPO lookback)", () => {
    expect(ruleOf(gate(healthy(59)))).toBe("G2");
    expect(ruleOf(gate(healthy(60)))).toBe("pass");
  });

  test("G3: traded on at least 18 of the 20 sessions before t", () => {
    const rows = healthy();
    for (const index of [45, 50]) rows[index] = { ...rows[index], volume: 0 };
    expect(ruleOf(gate(rows))).toBe("pass");
    rows[55] = { ...rows[55], volume: 0 };
    expect(ruleOf(gate(rows))).toBe("G3");
  });

  test("G4: average value over the 20 sessions before t ≥ Rp 1 bn; a stored session value wins over close × volume", () => {
    const thin = bars(Array.from({ length: 60 }, (): Row => [1000, 1010, 990, 1000, 999_999]));
    expect(ruleOf(gate(thin))).toBe("G4");
    const reported = thin.map((bar) => ({ ...bar, value: 1_000_000_000 }));
    expect(gate(reported)).toMatchObject({ ok: true, averageValueIdr: 1_000_000_000, valueEstimatedSessions: 0 });
  });

  test("G5: close on t ≥ Rp 100", () => {
    const rows = bars(Array.from({ length: 60 }, (): Row => [99, 100, 98, 99, 20_000_000]));
    expect(ruleOf(gate(rows))).toBe("G5");
  });

  test("G6: inconsistent OHLC on a row the rules read skips the symbol; older rows are not read", () => {
    const rows = healthy();
    rows[50] = { ...rows[50], high: 980 };
    expect(gate(rows)).toMatchObject({ ok: false, rule: "G6", detail: `inconsistent row ${rows[50].date}` });
    const missing = healthy();
    missing[59] = { ...missing[59], open: null };
    expect(ruleOf(gate(missing))).toBe("G6");
    const old = healthy();
    old[0] = { ...old[0], low: 2000 };
    expect(ruleOf(gate(old))).toBe("pass");
  });

  test("G7: special notation, watchlist and acceleration boards are excluded; unknown is flagged, not assumed", () => {
    expect(ruleOf(gate(healthy(), { security: { notation: "X" } }))).toBe("G7");
    expect(ruleOf(gate(healthy(), { security: { board: "Papan Pemantauan Khusus", notation: "" } }))).toBe("G7");
    expect(ruleOf(gate(healthy(), { security: { board: "Akselerasi", notation: "" } }))).toBe("G7");
    expect(gate(healthy(), { security: { board: "Pengembangan", notation: null } })).toMatchObject({ ok: true, boardKnown: false });
  });

  test("G8: a split ex-date inside the rows used excludes the symbol", () => {
    const rows = healthy();
    expect(ruleOf(gate(rows, { splitExDates: [rows[55].date] }))).toBe("G8");
    expect(ruleOf(gate(rows, { splitExDates: [rows[10].date] }))).toBe("pass");
  });
});

describe("scanUniverse", () => {
  const rules = withRules({ gate: { minHistory: 0, minTradedSessions: 0, liquidityLookback: 5, minPriceIdr: 0 }, breakout: { lookback: 5, relativeVolumeLookback: 5 } });
  const base: Row[] = [
    [1000, 1020, 990, 1010, 1_000_000], [1010, 1030, 1000, 1020, 1_100_000], [1020, 1040, 1005, 1015, 900_000],
    [1015, 1035, 1000, 1025, 1_000_000], [1025, 1040, 1015, 1030, 1_000_000], [1030, 1035, 1020, 1030, 1_000_000],
  ];
  const input = () => ({
    session: SESSION, rules, splitExDates: new Map<string, string[]>(),
    securities: [security({ symbol: "ZZZZ" }), security({ symbol: "AAAA" }), security({ symbol: "MMMM" }), security({ symbol: "THIN" }), security({ symbol: "GONE" })],
    bars: new Map<string, Bar[]>([
      ["ZZZZ", bars([...base, [1035, 1090, 1030, 1080, 3_000_000]])],
      ["AAAA", bars([...base, [1035, 1090, 1030, 1080, 3_000_000]])],
      ["MMMM", bars([...base, [1035, 1120, 1030, 1110, 3_000_000]])],
      ["THIN", bars([...base, [1035, 1090, 1030, 1080, 1_200_000]])],
      ["GONE", bars(base).map((bar) => ({ ...bar, date: `2026-09-${bar.date.slice(8)}` }))],
    ]),
  });

  test("sorts by breakoutPercent desc then symbol, counts gate failures and misses, adds the common notes", () => {
    const result = scanUniverse(input());
    expect(result.candidates.map((c) => `${c.strategyId}:${c.symbol}:${c.rank}`)).toEqual(["breakout:MMMM:0", "breakout:AAAA:1", "breakout:ZZZZ:2"]);
    expect(result.universe).toEqual({ covered: 5, eligible: 4, skipped: 1 });
    expect(result.gateFailures.G1).toBe(1);
    expect(result.misses.breakout).toEqual({ rule2: 1 });
    expect(result.misses["bb-reversal"]).toEqual({ inputs: 4 });
    const first = result.candidates[0];
    expect(first.metrics.find((m) => m.key === "boardKnown")).toEqual({ key: "boardKnown", value: 0, unit: "count" });
    expect(first.reasons.filter((r) => r.kind === "note").map((r) => r.kind === "note" && r.text)).toEqual([
      "Closed at Rp 1,110, above the highest price of the previous 5 sessions (Rp 1,040).",
      expect.stringContaining("Board and special notation are not reported"),
      "Average traded value is partly estimated as close × volume.",
      "Draft rules 0.1-draft (HAKA-17), not yet approved by the owner.",
    ]);
  });

  test("is deterministic: same input, same output, whatever the input order", () => {
    const a = scanUniverse(input());
    const shuffled = input();
    shuffled.securities.reverse();
    expect(scanUniverse(shuffled)).toEqual(a);
  });

  test("reports G6 rows for the strategy_bad_row log", () => {
    const broken = input();
    broken.bars.set("AAAA", broken.bars.get("AAAA")!.map((bar, index) => (index === 3 ? { ...bar, low: null } : bar)));
    const result = scanUniverse(broken);
    expect(result.badRows).toEqual([{ symbol: "AAAA", detail: expect.stringContaining("inconsistent row") }]);
    expect(result.gateFailures.G6).toBe(1);
  });
});

describe("wording (§3.5, MIGRATION §9 item 5)", () => {
  test("labels, descriptions, reasons and notes contain no advice, direction or performance language", () => {
    const texts = [
      ...builtStrategies().flatMap((s) => [s.label, s.description]),
      ...NOT_BUILT_STRATEGIES.flatMap((s) => [s.label, s.reason]),
    ];
    const rules = withRules({ gate: { minHistory: 0, minTradedSessions: 0, liquidityLookback: 5, minPriceIdr: 0 }, breakout: { lookback: 5, relativeVolumeLookback: 5 }, bbReversal: { period: 10 } });
    const rows = bars([[1000, 1020, 990, 1010], [1010, 1030, 1000, 1020], [1020, 1040, 1005, 1015], [1015, 1035, 1000, 1025], [1025, 1040, 1015, 1030], [1030, 1035, 1020, 1030], [1035, 1090, 1030, 1080, 3_000_000]]);
    const scan = scanUniverse({ session: SESSION, rules, securities: [security()], bars: new Map([["TEST", rows]]), splitExDates: new Map() });
    expect(scan.candidates).toHaveLength(1);
    for (const reason of scan.candidates.flatMap((c) => c.reasons)) if (reason.kind === "note") texts.push(reason.text);
    for (const text of texts) expect(forbiddenWordingIn(text), text).toBeNull();
    for (const key of ENGINE_CRITERION_KEYS) {
      for (const locale of [en, id]) expect(forbiddenWordingIn((locale.criteria as Record<string, string>)[key]), key).toBeNull();
    }
  });

  test("the draft's wording rules would catch a slip", () => {
    for (const bad of ["Buy now", "price target", "entry level", "win rate 70%", "⬆️ BBCA", "beli sore jual pagi"]) expect(forbiddenWordingIn(bad), bad).not.toBeNull();
  });
});
