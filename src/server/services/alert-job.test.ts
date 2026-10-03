import { expect, test, vi } from "vitest";
import { fixture } from "../../../tests/support/fixtures";
import { withFreshness } from "@/lib/freshness";
import { historyResponseSchema } from "@/server/schemas/arjum";
import { normalizeHistory } from "./arjum-normalize";
import { quoteFromHistory, runAlertJob } from "./alert-job";

const history = normalizeHistory(historyResponseSchema.parse(fixture("history")));
const alert = (id: string, metric: string, operator: string, threshold: number, symbol = "BBCA") => ({ id, symbol, metric, operator, threshold });
const ids = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];

test("quote mapping keeps percent units and derives previous close", () => {
  const { quote } = quoteFromHistory(history)!;
  expect(quote).toMatchObject({ date: "2026-09-18", close: 6300, change: -50, previousClose: 6350, changePercent: -0.79 });
});

test("evaluates only EOD data; triggers idempotently; malformed rows fail", async () => {
  const insertEvent = vi.fn(async () => true);
  const result = await runAlertJob({
    fetchAlerts: async (offset) => (offset === 0 ? [alert(ids[0], "PRICE", "LT", 6400), alert(ids[1], "DAILY_CHANGE", "GT", 1), { id: "bad" }] : []),
    getHistory: async () => withFreshness(history, { freshness: "EOD", asOf: "2026-09-18", source: "test" }),
    insertEvent,
  });
  expect(result).toEqual({ evaluated: 2, triggered: 1, unavailable: 0, failed: 1 });
  expect(insertEvent).toHaveBeenCalledWith({ alertId: ids[0], value: 6300, asOf: "2026-09-18" });
});

test.each(["DELAYED", "STALE", "HISTORICAL", "UNAVAILABLE"] as const)("%s data is never evaluated", async (freshness) => {
  const insertEvent = vi.fn(async () => true);
  const result = await runAlertJob({
    fetchAlerts: async (offset) => (offset === 0 ? [alert(ids[0], "PRICE", "GT", 0)] : []),
    getHistory: async () => withFreshness(history, { freshness, asOf: "2026-09-18", source: "test" }),
    insertEvent,
  });
  expect(result).toMatchObject({ evaluated: 0, unavailable: 1 });
  expect(insertEvent).not.toHaveBeenCalled();
});

test("history fetched once per symbol; provider errors count as unavailable", async () => {
  const getHistory = vi.fn(async () => { throw new Error("down"); });
  const result = await runAlertJob({ fetchAlerts: async (offset) => (offset === 0 ? [alert(ids[0], "PRICE", "GT", 0), alert(ids[1], "VOLUME", "GT", 0)] : []), getHistory, insertEvent: async () => true });
  expect(getHistory).toHaveBeenCalledTimes(1);
  expect(result.unavailable).toBe(2);
});
