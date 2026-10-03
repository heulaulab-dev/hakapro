import { describe, expect, test } from "vitest";
import { fixture } from "../../../tests/support/fixtures";
import {
  analysisResponseSchema, brokerAccumulationResponseSchema, brokerSummaryResponseSchema, doneDetailsResponseSchema,
  financialStatementsResponseSchema, healthResponseSchema, historyResponseSchema, insidersResponseSchema,
  marketCapResponseSchema, screenerResponseSchema, searchResponseSchema, seasonalityResponseSchema,
} from "./arjum";

describe("arjum recorded response contracts (Zod 4)", () => {
  test.each([
    ["search", searchResponseSchema], ["screener", screenerResponseSchema], ["analysis", analysisResponseSchema],
    ["broker-summary", brokerSummaryResponseSchema], ["broker-accumulation", brokerAccumulationResponseSchema],
    ["history", historyResponseSchema], ["seasonal", seasonalityResponseSchema], ["market-cap", marketCapResponseSchema],
    ["financial-statements", financialStatementsResponseSchema], ["insiders", insidersResponseSchema],
    ["done-details", doneDetailsResponseSchema], ["health", healthResponseSchema],
  ] as const)("%s parses", (name, schema) => {
    expect(schema.safeParse(fixture(name)).success).toBe(true);
  });

  test("rejects a numeric field delivered as a string", () => {
    const value = fixture<{ rows: Array<{ close: unknown }> }>("history");
    value.rows[0].close = "6300";
    expect(historyResponseSchema.safeParse(value).success).toBe(false);
  });

  test("rejects non-finite numbers", () => {
    const value = fixture<{ rows: Array<{ close: unknown }> }>("history");
    value.rows[0].close = Number.POSITIVE_INFINITY;
    expect(historyResponseSchema.safeParse(value).success).toBe(false);
  });
});

test("live drift: a broker level side can be null; history average can be null", () => {
  const brokers = fixture<{ broker_levels: Array<{ sell: unknown }> }>("broker-summary");
  brokers.broker_levels[brokers.broker_levels.length - 1].sell = null;
  expect(brokerSummaryResponseSchema.safeParse(brokers).success).toBe(true);
  const history = fixture<{ rows: Array<{ avg: unknown }> }>("history");
  history.rows[3].avg = null;
  expect(historyResponseSchema.safeParse(history).success).toBe(true);
});
