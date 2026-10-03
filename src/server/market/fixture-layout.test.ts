import { describe, expect, test } from "vitest";
import { fixture } from "../../../tests/support/fixtures";
import { doneDetailsResponseSchema, insidersResponseSchema } from "@/server/schemas/arjum";
import { fixturePath, hostOf, sanitizeRecording } from "./fixture-layout";

describe("sanitizeRecording", () => {
  test("drops credential and user-identifier keys at any depth", () => {
    const input = {
      stock_code: "BBCA",
      api_key: "k", apiKey: "k", "api-key": "k", access_token: "t", client_secret: "s", Authorization: "a",
      password: "p", cookie: "c", session_id: "s", email: "e@x.test", user_id: "u", userId: "u",
      nested: [{ token: "t", keep: 1, deeper: { refresh_token: "r", value: 2 } }],
    };
    expect(sanitizeRecording(input, [])).toEqual({ stock_code: "BBCA", nested: [{ keep: 1, deeper: { value: 2 } }] });
  });

  test("replaces the API key value and provider host wherever they appear in strings", () => {
    const key = "sk_live_0123456789";
    const output = sanitizeRecording({ note: `echo ${key}`, link: "https://provider.example.test/api/x", list: [key] }, [key, "provider.example.test"]);
    expect(JSON.stringify(output)).not.toContain(key);
    expect(JSON.stringify(output)).not.toContain("provider.example.test");
    expect(output).toEqual({ note: "echo [REDACTED]", link: "https://[REDACTED]/api/x", list: ["[REDACTED]"] });
  });

  test("ignores empty or very short secrets instead of shredding every string", () => {
    expect(sanitizeRecording({ a: "abc" }, ["", " ", "ab"])).toEqual({ a: "abc" });
  });

  test("redacts done-details order numbers and the result still matches the schema", () => {
    const clean = doneDetailsResponseSchema.parse(sanitizeRecording(fixture("done-details"), []));
    expect(clean.data.every((row) => row.buy_order_number === "REDACTED" && row.sell_order_number === "REDACTED")).toBe(true);
  });

  test("keeps public disclosure data (insider names, broker codes)", () => {
    const raw = insidersResponseSchema.parse(fixture("insiders"));
    const clean = insidersResponseSchema.parse(sanitizeRecording(raw, []));
    expect(clean.items.map((row) => row.name)).toEqual(raw.items.map((row) => row.name));
    expect(clean.items.map((row) => row.broker_code)).toEqual(raw.items.map((row) => row.broker_code));
  });
});

test("fixturePath layout", () => {
  expect(fixturePath("screener")).toBe("global/screener.json");
  expect(fixturePath("search", { symbol: "SOCI" })).toBe("search/SOCI.json");
  expect(fixturePath("history", { symbol: "SOCI" })).toBe("symbols/SOCI/history.json");
  expect(fixturePath("financial-statements", { symbol: "SOCI", reportType: "CASH_FLOW" })).toBe("symbols/SOCI/financial-statements.CASH_FLOW.json");
  expect(() => fixturePath("history")).toThrow();
});

test("hostOf", () => {
  expect(hostOf("https://provider.example.test:8443/base")).toBe("provider.example.test:8443");
  expect(hostOf("not a url")).toBeNull();
});
