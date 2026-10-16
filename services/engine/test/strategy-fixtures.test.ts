import { expect, test } from "vitest";
import { fixtureScan } from "./strategy-fixtures";

test("the fixture universe produces the documented outcome at the draft's default rules", () => {
  const result = fixtureScan();
  expect(result.candidates.map((candidate) => `${candidate.strategyId}:${candidate.symbol}`)).toEqual(["breakout:BRKT", "bb-reversal:BBRV"]);
  expect(result.universe).toEqual({ covered: 7, eligible: 3, skipped: 4 });
  expect(result.gateFailures).toMatchObject({ G2: 1, G4: 1, G7: 1, G8: 1 });
});
