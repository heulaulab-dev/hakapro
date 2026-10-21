import { describe, expect, test } from "vitest";
import { makeRows } from "../../../tests/support/history-rows";
import type { InsiderRow } from "./arjum-normalize";
import { counterEvidence, disagrees, insiderFacts, priceChangeSince, sessionWindows, volumeFacts } from "./research-evidence";

const insider = (date: string, action: InsiderRow["action"], changeShares: number): InsiderRow => ({
  person: `Person ${date}`, date, action, nationality: "ID", roles: ["Direktur"], broker: null,
  previousShares: null, currentShares: null, changeShares, previousPercent: null, currentPercent: null, changePercent: null, priceIdr: null,
});

describe("session windows", () => {
  test("price change and net foreign cover exactly the same sessions", () => {
    // 32 rows: closes 100..131, foreign +10 per session except the last five at -100.
    const closes = Array.from({ length: 32 }, (_, index) => 100 + index);
    const foreign = closes.map((_, index) => (index >= 27 ? -100 : 10));
    const rows = makeRows(closes, { foreign });
    const windows = sessionWindows(rows);
    expect(windows["1D"]).toMatchObject({ sessions: 1, start: rows[31].date, end: rows[31].date, foreignNetShares: -100, foreignSellSessions: 1 });
    expect(windows["1D"]!.priceChangePercent).toBeCloseTo(((131 - 130) / 130) * 100, 2);
    // 5D: base is the close before the window (row 26), flow is rows 27..31.
    expect(windows["5D"]).toMatchObject({ start: rows[27].date, end: rows[31].date, foreignNetShares: -500, foreignBuySessions: 0, foreignSellSessions: 5 });
    expect(windows["5D"]!.priceChangePercent).toBeCloseTo(((131 - 126) / 126) * 100, 2);
    expect(windows["7D"]!.foreignNetShares).toBe(-500 + 20);
    expect(windows["30D"]).toMatchObject({ sessions: 30, start: rows[2].date, foreignNetShares: 25 * 10 - 500 });
  });

  test("a window without the close before it is null, never a partial figure", () => {
    const windows = sessionWindows(makeRows(Array.from({ length: 14 }, (_, index) => 100 + index)));
    expect(windows["7D"]).not.toBeNull();
    expect(windows["14D"]).toBeNull();
    expect(windows["30D"]).toBeNull();
    expect(sessionWindows([])["1D"]).toBeNull();
  });
});

describe("volume against the 20-session baseline", () => {
  test("the latest session is compared with the 20 sessions before it, not with itself", () => {
    const volume = [...Array.from({ length: 21 }, () => 999), ...Array.from({ length: 20 }, () => 1_000), 3_000];
    const rows = makeRows(volume.map(() => 100), { volume, value: volume.map((v) => v * 100), frequency: volume.map(() => 10) });
    const facts = volumeFacts(rows)!;
    expect(facts.baselineSessions).toBe(20);
    expect(facts.avgVolumeShares).toBe(1_000);
    expect(facts.volumeRatio).toBe(3);
    expect(facts.valueRatio).toBe(3);
    expect(facts.orderSizeRatio).toBe(3);
    expect(volumeFacts(rows.slice(-20))).toBeNull();
  });
});

describe("insider lookback", () => {
  test("counts BUY/SELL by absolute size within the calendar lookback only", () => {
    const facts = insiderFacts([insider("2026-10-20", "BUY", 1_000), insider("2026-10-10", "SELL", -5_000), insider("2026-09-01", "BUY", 9_999), insider("2026-10-22", "BUY", 1)], "2026-10-21", 30);
    expect(facts).toMatchObject({ since: "2026-09-21", transactions: 2, buys: 1, sells: 1, netShares: -4_000, latestDate: "2026-10-20" });
  });
});

describe("counter-evidence (acceptance criterion 4)", () => {
  const up = makeRows(Array.from({ length: 32 }, (_, index) => 100 + index), { foreign: Array.from({ length: 32 }, () => -1_000_000) });

  test("listed for every window where price direction and net foreign disagree, in id and en", () => {
    const items = counterEvidence({ windows: sessionWindows(up) });
    expect(items.map((item) => item.key)).toEqual(["foreign_1D", "foreign_5D", "foreign_7D", "foreign_14D", "foreign_30D"]);
    const fiveDay = items.find((item) => item.key === "foreign_5D")!;
    expect(fiveDay.window).toBe("5D");
    expect(fiveDay.text.id).toMatch(/^Harga naik 3,97% dalam 5 sesi hingga 21 Okt 2026, sementara investor asing mencatat jual bersih 5 jt lembar/);
    expect(fiveDay.text.en).toMatch(/^Price rose 3\.97% over 5 sessions to Oct 21, 2026, while foreign investors were net sellers of 5M shares/);
  });

  test("absent when they agree or either side is flat", () => {
    const agree = makeRows(Array.from({ length: 32 }, (_, index) => 100 + index), { foreign: Array.from({ length: 32 }, () => 1) });
    expect(counterEvidence({ windows: sessionWindows(agree) })).toEqual([]);
    const flat = makeRows(Array.from({ length: 32 }, () => 100), { foreign: Array.from({ length: 32 }, () => -1) });
    expect(counterEvidence({ windows: sessionWindows(flat) })).toEqual([]);
    expect(disagrees(1, 0)).toBe(false);
    expect(disagrees(-2, 5)).toBe(true);
  });

  test("price down with net foreign buying is listed too", () => {
    const down = makeRows(Array.from({ length: 6 }, (_, index) => 200 - index), { foreign: Array.from({ length: 6 }, () => 500) });
    const [item] = counterEvidence({ windows: sessionWindows(down) });
    expect(item.key).toBe("foreign_1D");
    expect(item.text.en).toContain("Price fell");
    expect(item.text.en).toContain("net buyers");
    expect(item.text.id).toContain("beli bersih");
  });

  test("broker category flow counts only for the same sessions as the price change", () => {
    const agreeing = makeRows(Array.from({ length: 32 }, (_, index) => 100 + index), { foreign: Array.from({ length: 32 }, () => 1) });
    const windows = sessionWindows(agreeing);
    const same = { netValueIdr: -2e9, start: windows["5D"]!.start, end: windows["5D"]!.end };
    expect(counterEvidence({ windows, brokerForeign: { "5D": same } }).map((item) => item.key)).toEqual(["broker_foreign_5D"]);
    expect(counterEvidence({ windows, brokerForeign: { "5D": { ...same, start: "2026-01-01" } } })).toEqual([]);
  });

  test("insider net sales against a rising price over the lookback", () => {
    const facts = insiderFacts([insider("2026-10-15", "SELL", -2_000_000)], "2026-10-21", 30);
    const flat = makeRows(Array.from({ length: 32 }, () => 100));
    const rows = makeRows(Array.from({ length: 32 }, (_, index) => 100 + index));
    const item = counterEvidence({ windows: sessionWindows(flat), insider: { facts, price: priceChangeSince(rows, facts.since) } }).at(-1)!;
    expect(item).toMatchObject({ key: "insider", component: "insider", window: "30d" });
    expect(item.text.id).toContain("penjualan bersih 2 jt lembar dalam 30 hari terakhir");
    expect(item.text.en).toContain("net sales of 2M shares in the last 30 days");
  });

  test("texts stay neutral: no advice labels", () => {
    const texts = counterEvidence({ windows: sessionWindows(up) }).flatMap((item) => [item.text.id, item.text.en]);
    for (const text of texts) expect(text).not.toMatch(/\b(BUY|SELL|ACCUMULATE|STRONG|EXIT|AKUMULASI|DISTRIBUSI)\b|recommend|rekomendasi|target/i);
  });
});
