import { describe, expect, it } from "vitest";
import { parsePercent } from "./numbers";

describe("parsePercent", () => {
  it("normalizes XLSX floating-point artifacts", () => {
    expect(parsePercent("1.1500000000000001")).toBe("1.15");
    expect(parsePercent("54.94000000000001")).toBe("54.94");
  });

  it("still rejects genuinely over-precise values", () => {
    expect(() => parsePercent("1.123456789")).toThrow(/more than 6 decimals/);
  });
});
