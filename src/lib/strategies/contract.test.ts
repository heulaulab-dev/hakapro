import { describe, expect, test } from "vitest";
import en from "@/i18n/messages/en.json";
import id from "@/i18n/messages/id.json";
import {
  candidatesFor, CRITERION_KEYS, criteriaOf, formatMetric, metricSchema, screenerCandidateSchema, screenerStrategySchema, strategyBoardSchema,
  textsOf, type ScreenerCandidate, type StrategyBoard,
} from "./contract";

const candidate = (overrides: Partial<ScreenerCandidate> = {}): ScreenerCandidate => ({
  symbol: "SOCI", name: "Soechi Lines Tbk.", strategyId: "akumulasi-senyap",
  detectedAt: "2026-09-18", dataAsOf: "2026-09-18", freshness: "HISTORICAL",
  score: null, reasons: [{ kind: "criterion", key: "foreignBuying" }], metrics: [], source: "ARJUM_SCREENER",
  ...overrides,
});

describe("ScreenerStrategy", () => {
  const strategy = { id: "akumulasi-senyap", label: "AKUMULASI SENYAP", description: null, source: "ARJUM_SCREENER", kind: "EOD", dataAsOf: "2026-09-18", freshness: "HISTORICAL" };

  test("accepts every declared source, including engines not implemented yet", () => {
    for (const source of ["ARJUM_SCREENER", "HAKAPRO_EOD_ENGINE", "HAKAPRO_REALTIME_ENGINE"]) {
      expect(screenerStrategySchema.safeParse({ ...strategy, source }).success).toBe(true);
    }
  });

  test("rejects unknown sources, kinds and freshness states", () => {
    expect(screenerStrategySchema.safeParse({ ...strategy, source: "HEULATRADE_EOD_ENGINE" }).success).toBe(false);
    expect(screenerStrategySchema.safeParse({ ...strategy, kind: "INTRADAY" }).success).toBe(false);
    expect(screenerStrategySchema.safeParse({ ...strategy, freshness: "SNAPSHOT" }).success).toBe(false);
  });

  test("an unreadable data date is null, not absent", () => {
    expect(screenerStrategySchema.safeParse({ ...strategy, dataAsOf: null }).success).toBe(true);
    const { dataAsOf: _omitted, ...withoutDate } = strategy;
    expect(screenerStrategySchema.safeParse(withoutDate).success).toBe(false);
  });
});

describe("ScreenerCandidate", () => {
  test("score is nullable but required", () => {
    expect(screenerCandidateSchema.parse(candidate()).score).toBeNull();
    expect(screenerCandidateSchema.parse(candidate({ score: 72 })).score).toBe(72);
    const { score: _omitted, ...withoutScore } = candidate();
    expect(screenerCandidateSchema.safeParse(withoutScore).success).toBe(false);
  });

  test("criterion reasons only use keys HAKAPRO words itself", () => {
    expect(screenerCandidateSchema.safeParse(candidate({ reasons: [{ kind: "criterion", key: "winRate" as never }] })).success).toBe(false);
    expect(screenerCandidateSchema.safeParse(candidate({ reasons: [{ kind: "unrecognized", code: "🦄", label: null }] })).success).toBe(true);
  });

  test("every criterion key has wording in both locales", () => {
    for (const key of CRITERION_KEYS) {
      expect(en.criteria, key).toHaveProperty(key);
      expect(id.criteria, key).toHaveProperty(key);
    }
  });
});

describe("metrics", () => {
  test("a missing value is null, never coerced to zero", () => {
    expect(metricSchema.parse({ key: "value", value: null, unit: "idr" }).value).toBeNull();
    expect(metricSchema.safeParse({ key: "value", unit: "idr" }).success).toBe(false);
    expect(metricSchema.safeParse({ key: "value", value: 1, unit: "usd" }).success).toBe(false);
  });

  test("a missing value renders unavailable; zero renders zero", () => {
    expect(formatMetric({ key: "value", value: null, unit: "idr" }, "en")).toBe("—");
    expect(formatMetric({ key: "frequency", value: 0, unit: "count" }, "en")).toBe("0");
    expect(formatMetric({ key: "foreignNet", value: 1.5, unit: "percent" }, "en")).toBe("1.50%");
  });
});

describe("helpers", () => {
  const board: StrategyBoard = {
    contexts: [],
    strategies: [],
    candidates: [
      candidate({ symbol: "SOCI" }),
      candidate({ symbol: "SAPX", strategyId: "risiko-pantulan" }),
      candidate({ symbol: "HRTA" }),
    ],
  };

  test("candidatesFor keeps the source's order", () => {
    expect(candidatesFor(board, "akumulasi-senyap").map((item) => item.symbol)).toEqual(["SOCI", "HRTA"]);
    expect(candidatesFor(board, "missing")).toEqual([]);
    expect(strategyBoardSchema.safeParse(board).success).toBe(true);
  });

  test("reasons split into criteria, patterns and notes", () => {
    const reasons = candidate({ reasons: [
      { kind: "criterion", key: "historicalEdge" },
      { kind: "pattern", text: "Gabungan (Asing + Teknikal)" },
      { kind: "unrecognized", code: "🦄", label: "langka" },
      { kind: "note", text: "jatuh tajam" },
    ] }).reasons;
    expect(criteriaOf(reasons).map((reason) => reason.kind)).toEqual(["criterion", "unrecognized"]);
    expect(textsOf(reasons, "pattern")).toEqual(["Gabungan (Asing + Teknikal)"]);
    expect(textsOf(reasons, "note")).toEqual(["jatuh tajam"]);
  });
});
