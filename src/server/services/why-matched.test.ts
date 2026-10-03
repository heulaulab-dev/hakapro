import { describe, expect, test } from "vitest";
import { fixture } from "../../../tests/support/fixtures";
import { screenerResponseSchema, type ScreenerResponse } from "@/server/schemas/arjum";
import { KNOWN_FLAGS, parseLegend, parseStrategyScreen, strategyId, tokenizeFlags } from "./why-matched";

const recorded = () => screenerResponseSchema.parse(fixture("screener"));

describe("why matched — recorded screener V5.2", () => {
  test("snapshot of the structured screen", () => {
    expect(parseStrategyScreen(recorded())).toMatchSnapshot();
  });

  test("recorded sample has no unrecognized flags and no legend drift", () => {
    expect(parseStrategyScreen(recorded()).issues).toEqual([]);
  });

  test("the mapping table covers every legend entry in the recorded raw text", () => {
    const legend = parseLegend(recorded().raw);
    expect(legend.size).toBe(Object.keys(KNOWN_FLAGS).length);
    for (const [flag, meta] of Object.entries(KNOWN_FLAGS)) {
      expect(legend.get(flag.replace(/️/g, ""))).toBe(meta.providerLabel);
    }
  });
});

describe("tokenizing flags", () => {
  test("splits spaced and concatenated flags, including the two-glyph pump flag", () => {
    expect(tokenizeFlags("🌍 🥷")).toEqual(["🌍", "🥷"]);
    expect(tokenizeFlags("🌍🥷🚀⚠️")).toEqual(["🌍", "🥷", "🚀⚠️"]);
    expect(tokenizeFlags("🏛 ✅")).toEqual(["🏛️", "✅"]); // missing variation selector still matches
  });

  test("strategy ids are stable slugs without emoji", () => {
    expect(strategyId("🥷 AKUMULASI SENYAP")).toBe("akumulasi-senyap");
  });
});

describe("unknown flags are surfaced, never dropped", () => {
  const withRow = (summary: string, raw?: string): ScreenerResponse => {
    const base = recorded();
    return { ...base, raw: raw ?? base.raw, rows: [{ ...base.rows[0], summary }] };
  };

  test("an unknown flag becomes an unrecognized criterion and an issue", () => {
    const { screen, issues } = parseStrategyScreen(withRow("🌍 🦄"));
    expect(screen.strategies[0].matches[0].criteria).toEqual([
      { kind: "recognized", key: "foreignBuying", flag: "🌍" },
      { kind: "unrecognized", flag: "🦄", providerLabel: null },
    ]);
    expect(issues).toEqual([{ type: "unrecognized_flag", flag: "🦄", symbol: "SOCI", providerLabel: null }]);
  });

  test("a flag the provider legend defines but our table does not keeps the provider label", () => {
    const raw = recorded().raw.replace("🔥=klimaks", "🔥=klimaks | 🦄=langka");
    const { screen } = parseStrategyScreen(withRow("🦄", raw));
    expect(screen.strategies[0].matches[0].criteria).toEqual([{ kind: "unrecognized", flag: "🦄", providerLabel: "langka" }]);
  });

  test("legend drift and unparseable dates are reported", () => {
    const base = recorded();
    const { screen, issues } = parseStrategyScreen({ ...base, date: "SCREENER V6", raw: base.raw.replace("🌍=asing beli", "🌍=asing net beli") });
    expect(screen.date).toBeNull();
    expect(issues).toContainEqual({ type: "legend_drift", flag: "🌍", expected: "asing beli", actual: "asing net beli" });
    expect(issues).toContainEqual({ type: "unparseable_date", text: "SCREENER V6" });
  });
});
