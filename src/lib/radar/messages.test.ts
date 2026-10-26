import { describe, expect, test } from "vitest";
import en from "@/i18n/messages/en.json";
import id from "@/i18n/messages/id.json";
import { RADAR_COUNTER_KEYS, RADAR_RULES_V0, RADAR_SIGNAL_KEYS, STEALTH_RULES_V0 } from "./rules";

function leaves(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key));
}
const NAMESPACES = ["radar", "stealth", "methodology"] as const;

describe("radar, KSEI view and methodology messages", () => {
  test("ID and EN have the same keys", () => {
    for (const namespace of NAMESPACES) {
      expect(leaves(en[namespace]).map(([key]) => key).sort(), namespace).toEqual(leaves(id[namespace]).map(([key]) => key).sort());
    }
    for (const key of ["radar", "stealth", "methodology"]) {
      expect(en.nav).toHaveProperty(key);
      expect(id.nav).toHaveProperty(key);
    }
  });

  test("every signal and counter-evidence rule has a name, chip text and a methodology description", () => {
    for (const messages of [id, en]) {
      for (const key of RADAR_SIGNAL_KEYS) {
        expect(messages.radar.name).toHaveProperty(key);
        expect(messages.methodology.radar.describe).toHaveProperty(key);
      }
      for (const key of RADAR_COUNTER_KEYS) {
        expect(messages.radar.counterName).toHaveProperty(key);
        expect(messages.methodology.counter.describe).toHaveProperty(key);
      }
    }
  });

  test("neutral wording: observations, never advice labels", () => {
    for (const namespace of NAMESPACES) {
      for (const [key, message] of [...leaves(id[namespace]), ...leaves(en[namespace])]) {
        const text = message.replace(/\{[^}]*\}/g, "");
        expect(text, `${namespace}.${key}`).not.toMatch(/\b(BUY|SELL|STRONG BUY|ACCUMULATE|AKUMULASI|DISTRIBUSI|EXIT)\b/);
        expect(text, `${namespace}.${key}`).not.toMatch(/accumulat|akumulasi|distribusi|recommend|rekomendasi|price target|target harga|stealth/i);
      }
    }
  });

  test("radar and KSEI view strings name no internal tooling (only the methodology's source list names providers)", () => {
    for (const namespace of ["radar", "stealth"] as const) {
      for (const [key, message] of [...leaves(id[namespace]), ...leaves(en[namespace])]) {
        expect(message, `${namespace}.${key}`).not.toMatch(/arjum|idx-bei|yahoo|tradingview|pasardana|fixture|\bjob\b|cron|daily_prices|ownership_changes/i);
      }
    }
    for (const [key, message] of [...leaves(id.methodology), ...leaves(en.methodology)]) {
      expect(message, key).not.toMatch(/daily_prices|ownership_changes|foreign-flow|eod-daily|\bjob\b|cron|fixture/i);
    }
  });

  test("the rules are drafts without a backtest, and versioned", () => {
    expect(RADAR_RULES_V0.backtested).toBe(false);
    expect(STEALTH_RULES_V0.backtested).toBe(false);
    expect(RADAR_RULES_V0.version).toMatch(/^radar-v\d/);
    expect(STEALTH_RULES_V0.version).toMatch(/^ksei-corporate-v\d/);
  });
});
