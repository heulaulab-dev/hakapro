import { describe, expect, test } from "vitest";
import { monogramHue, monogramLetters } from "./ticker-logo";

describe("ticker monogram", () => {
  test("hue is stable per symbol", () => {
    expect(monogramHue("BBCA")).toBe(monogramHue("BBCA"));
  });

  test("hue never lands on a market color (no greens, no reds)", () => {
    const symbols = ["BBCA", "BBRI", "BMRI", "TLKM", "ASII", "GOTO", "ANTM", "ADRO", "UNVR", "ICBP", "BRIS", "AMMN", "TPIA", "BREN", "CUAN"];
    for (const symbol of symbols) {
      const hue = monogramHue(symbol);
      expect(hue >= 120 && hue <= 170, `${symbol} hue ${hue} is green`).toBe(false);
      expect(hue <= 40 || hue >= 340, `${symbol} hue ${hue} is red`).toBe(false);
    }
  });

  test("different symbols spread over several hues", () => {
    const hues = new Set(["BBCA", "BBRI", "BMRI", "TLKM", "ASII", "GOTO", "ANTM", "ADRO"].map(monogramHue));
    expect(hues.size).toBeGreaterThanOrEqual(4);
  });

  test("letters are the leading pair, uppercased", () => {
    expect(monogramLetters("bbca")).toBe("BB");
    expect(monogramLetters("TLKM")).toBe("TL");
  });
});
