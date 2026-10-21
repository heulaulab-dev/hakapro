import { describe, expect, test } from "vitest";
import { collectAllowed, readings, tokenize, validateNumbers } from "./number-validator";

const facts = {
  code: "BBCA",
  asOf: "2026-10-21T15:49:00+07:00",
  session: "2026-10-21",
  price: { last: 9875, change: -125, changePct: -1.25 },
  completeness: { componentsOk: 4, componentsTotal: 6, confidence: 0.67 },
  momentum: { change5DPct: 3.21, sma20: 9_712.4, close: 9875 },
  broker: { foreign30D: -2_140_000_000_000, domestic30D: 3_050_000_000, start30D: "2026-09-08" },
  volume: { volumeShares: 57_300_000, volumeRatio: 1.84, baselineSessions: 20 },
  insider: { transactions: 3, netShares: -50_000, lookbackDays: 30 },
  ksei: { month: "2026-09", largestHolderPct: 54.94 },
  windows: ["1D", "5D", "30D"],
  counterEvidence: ["Harga naik 3,21% dalam 5 sesi hingga 21 Okt 2026, sementara investor asing mencatat jual bersih 1,2 jt lembar pada periode yang sama."],
};

const ok = (text: string, ...sources: unknown[]) => validateNumbers(text, ...(sources.length ? sources : [facts]));

describe("readings", () => {
  test("Indonesian and English grouping with a decimal part are unambiguous", () => {
    expect(readings("1.234,5")).toEqual([{ value: 1234.5, decimals: 1 }]);
    expect(readings("1,234.5")).toEqual([{ value: 1234.5, decimals: 1 }]);
    expect(readings("1.234.567")).toEqual([{ value: 1234567, decimals: 0 }]);
    expect(readings("1,234,567")).toEqual([{ value: 1234567, decimals: 0 }]);
  });
  test("one separator before exactly three digits is read both ways", () => {
    expect(readings("1.234")).toEqual([{ value: 1.234, decimals: 3 }, { value: 1234, decimals: 0 }]);
    expect(readings("9,875")).toEqual([{ value: 9.875, decimals: 3 }, { value: 9875, decimals: 0 }]);
    expect(readings("0,125")).toEqual([{ value: 0.125, decimals: 3 }]);
  });
  test("any other single separator is a decimal point", () => {
    expect(readings("2,1")).toEqual([{ value: 2.1, decimals: 1 }]);
    expect(readings("3.21")).toEqual([{ value: 3.21, decimals: 2 }]);
    expect(readings("12")).toEqual([{ value: 12, decimals: 0 }]);
  });
});

describe("tokenize", () => {
  test("dates are taken before numbers, so their digits are not re-read", () => {
    const tokens = tokenize("Per 21 Oktober 2026 harga Rp9.875.");
    expect(tokens.map((token) => token.kind)).toEqual(["date", "number"]);
  });
  test("currency glued to digits, scale words and percent signs", () => {
    const [money, pct] = tokenize("Rp2,1 T dan +3,21%");
    expect(money).toMatchObject({ kind: "number", scales: [1e12] });
    expect(pct).toMatchObject({ kind: "number", percent: true });
  });
  test("digits glued to letters are not numbers; window labels and ratios are", () => {
    expect(tokenize("Q3 BBCA1 change5DPct")).toEqual([]);
    expect(tokenize("5D 2,5x").map((token) => token.raw)).toEqual(["5", "2,5"]);
  });
});

describe("validateNumbers: accepted", () => {
  test("Indonesian formats", () => {
    expect(ok("Harga terakhir Rp9.875, turun 1,25% atau Rp125.")).toMatchObject({ ok: true, unknown: [] });
    expect(ok("Rata-rata 20 hari (SMA20) Rp9.712,4.")).toMatchObject({ ok: true });
    expect(ok("SMA20 sekitar Rp9.712.")).toMatchObject({ ok: true }); // rounded to whole rupiah
  });
  test("English formats", () => {
    expect(ok("The last price was IDR 9,875, down 1.25%.")).toMatchObject({ ok: true });
    expect(ok("The 20-day average is 9,712.4.")).toMatchObject({ ok: true });
  });
  test("money with scale words, rounded to the shown precision, sign ignored", () => {
    expect(ok("Asing jual bersih Rp 2,1 T dalam 30D.")).toMatchObject({ ok: true });
    expect(ok("Asing jual bersih Rp2,14 triliun.")).toMatchObject({ ok: true });
    expect(ok("Foreign investors sold a net IDR 2.1 trillion.")).toMatchObject({ ok: true });
    expect(ok("Foreign net selling was Rp2.1T.")).toMatchObject({ ok: true });
    expect(ok("Domestik beli bersih Rp3,05 miliar (Rp3 M).")).toMatchObject({ ok: true });
    expect(ok("Domestic net buying of IDR 3.05B.")).toMatchObject({ ok: true });
    expect(ok("Volume 57,3 juta lembar, atau 57M lembar.")).toMatchObject({ ok: true }); // M as million
    expect(ok("Volume of 57.3 million shares (57.3M).")).toMatchObject({ ok: true });
    expect(ok("Orang dalam jual bersih 50 rb lembar; 50.000 lembar; 50K shares.")).toMatchObject({ ok: true });
    expect(ok("Asing −2,1 T.")).toMatchObject({ ok: true });
  });
  test("percentages, including a fraction shown as a percent", () => {
    expect(ok("Naik 3,21% dalam 5 sesi; kelengkapan data 67%.")).toMatchObject({ ok: true });
    expect(ok("Up 3.2 percent; 54,94 persen dimiliki pemegang terbesar.")).toMatchObject({ ok: true });
    expect(ok("Rasio volume 1,84x terhadap rata-rata 20 sesi.")).toMatchObject({ ok: true });
  });
  test("dates in every supported form, a month, a bare year and a WIB time", () => {
    expect(ok("Data per 21 Oktober 2026 pukul 15:49 WIB.")).toMatchObject({ ok: true });
    expect(ok("As of October 21, 2026 and 21 Oct 2026 (2026-10-21, 21/10/2026).")).toMatchObject({ ok: true });
    expect(ok("Sejak 8 Sep, data KSEI September 2026, tahun 2026.")).toMatchObject({ ok: true });
  });
  test("small integers equal to an integer in the JSON", () => {
    expect(ok("3 transaksi orang dalam dalam 30 hari; 4 dari 6 komponen tersedia.")).toMatchObject({ ok: true });
  });
  test("numbers quoted from a JSON string are allowed", () => {
    expect(ok("Investor asing mencatat jual bersih 1,2 jt lembar.")).toMatchObject({ ok: true });
  });
  test("text without numbers passes", () => {
    expect(ok("Data asing dan broker tidak tersedia.")).toEqual({ ok: true, checked: 0, unknown: [] });
  });
  test("several sources are merged (e.g. tool results plus the user's question)", () => {
    expect(validateNumbers("Harga Rp9.875 vs Rp9.000 yang Anda sebut.", facts, "Apakah BBCA di atas 9.000?")).toMatchObject({ ok: true });
  });
});

describe("validateNumbers: rejected", () => {
  test("a number that is not in the JSON", () => {
    expect(ok("Harga terakhir Rp9.900.")).toEqual({ ok: false, checked: 1, unknown: ["9.900"] });
    expect(ok("Price target 11,000.")).toMatchObject({ ok: false, unknown: ["11,000"] });
  });
  test("rounding beyond the shown precision", () => {
    expect(ok("Asing jual bersih Rp2,2 T.")).toMatchObject({ ok: false, unknown: ["2,2 T"] });
    expect(ok("Turun 1,3%.")).toMatchObject({ ok: true }); // 1.25 rounds half up to 1.3
    expect(ok("Turun 1,4%.")).toMatchObject({ ok: false });
    expect(ok("SMA20 Rp9.712,5.")).toMatchObject({ ok: false });
  });
  test("a wrong scale is a different number", () => {
    expect(ok("Asing jual bersih Rp2,1 miliar.")).toMatchObject({ ok: false });
  });
  test("derived figures the model computed itself", () => {
    expect(ok("Itu setara 573 rb lot.")).toMatchObject({ ok: false }); // 57.3M shares ÷ 100
    expect(ok("Net foreign selling was 4.2% of value.")).toMatchObject({ ok: false });
  });
  test("a bare small integer that only rounds from an unrelated value", () => {
    expect(validateNumbers("Ada 3 transaksi.", { changePct: 3.2 })).toMatchObject({ ok: false, unknown: ["3"] });
  });
  test("dates, months and times not in the JSON", () => {
    expect(ok("Per 22 Oktober 2026.")).toMatchObject({ ok: false });
    expect(ok("As of 2026-10-22.")).toMatchObject({ ok: false });
    expect(ok("Data Agustus 2026.")).toMatchObject({ ok: false });
    expect(ok("Pukul 16:00 WIB.")).toMatchObject({ ok: false });
    expect(ok("Pada 2025.")).toMatchObject({ ok: false });
  });
  test("lists every unknown token", () => {
    expect(ok("Rp9.875 lalu Rp10.500 dan 7,77%.")).toMatchObject({ ok: false, unknown: ["10.500", "7,77%"] });
  });
});

describe("collectAllowed", () => {
  test("a timestamp contributes its date and time in UTC and WIB", () => {
    const allowed = collectAllowed({ at: "2026-10-21T20:30:00Z" });
    expect([...allowed.dates].sort()).toEqual(["2026-10-21", "2026-10-22"]);
    expect([...allowed.times].sort()).toEqual(["03:30", "20:30"]);
  });
  test("keys are not values", () => {
    const allowed = collectAllowed({ change30DPct: null });
    expect(allowed.numbers).toEqual([]);
  });
});
