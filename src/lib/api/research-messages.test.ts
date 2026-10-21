import { describe, expect, test } from "vitest";
import en from "@/i18n/messages/en.json";
import id from "@/i18n/messages/id.json";

function leaves(value: unknown, path = ""): Array<[string, string]> {
  if (typeof value === "string") return [[path, value]];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => leaves(child, path ? `${path}.${key}` : key));
}

describe("research messages", () => {
  test("ID and EN have the same keys", () => {
    expect(leaves(en.research).map(([key]) => key).sort()).toEqual(leaves(id.research).map(([key]) => key).sort());
  });

  test("neutral wording and no internal tooling in user-facing strings", () => {
    for (const [key, message] of [...leaves(id.research), ...leaves(en.research)]) {
      const text = message.replace(/\{[^}]*\}/g, "");
      // Verdict labels (upper-case signal words) and advice wording.
      expect(text, key).not.toMatch(/\b(BUY|SELL|ACCUMULATE|STRONG BUY|EXIT|AKUMULASI|DISTRIBUSI)\b/);
      expect(text, key).not.toMatch(/accumulat|recommend|rekomendasi|price target|target harga|\bstrong buy\b/i);
      expect(text, key).not.toMatch(/arjum|idx-bei|motherduck|fixture|supabase|\bjob\b|cron/i);
    }
  });
});
