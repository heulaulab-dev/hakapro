import { describe, expect, it } from "vitest";
import {
  collectIndexSummary, indexSummaryParams, indexSummaryUrl, makeIdxIndexTransport, normalizeIndexCode,
  parseIdxIndexSummary, unavailableIdxTransport, IDX_PRIMARY_SOURCE_ID,
} from "./idx-primary";
import { FIXTURE_DATE, IDX_INDEX_SUMMARY_FIXTURE } from "./idx-primary.fixture";

describe("request construction", () => {
  it("targets the verified GetIndexSummary endpoint with YYYYMMDD + paging params", () => {
    expect(indexSummaryUrl()).toBe("https://www.idx.co.id/primary/TradingSummary/GetIndexSummary");
    expect(indexSummaryUrl("https://gateway.example/primary/")).toBe("https://gateway.example/primary/TradingSummary/GetIndexSummary");
    expect(indexSummaryParams("2026-01-05")).toEqual({ date: "20260105", start: "0", length: "9999" });
  });
});

describe("normalizeIndexCode", () => {
  it("maps IHSG → COMPOSITE and passes other codes through uppercased", () => {
    expect(normalizeIndexCode("IHSG")).toBe("COMPOSITE");
    expect(normalizeIndexCode("ihsg")).toBe("COMPOSITE");
    expect(normalizeIndexCode("idxenergy")).toBe("IDXENERGY");
    expect(normalizeIndexCode(" LQ45 ")).toBe("LQ45");
  });
});

describe("parseIdxIndexSummary — validation + normalization", () => {
  const parsed = parseIdxIndexSummary(IDX_INDEX_SUMMARY_FIXTURE, FIXTURE_DATE);

  it("keeps only valid rows and normalizes to index_daily shape", () => {
    expect(parsed.rows.map((r) => r.code)).toEqual(["COMPOSITE", "IDXENERGY"]);
    expect(parsed.rows[0]).toEqual({
      code: "COMPOSITE", date: "2026-01-05", name: null, open: 7010, high: 7080, low: 6990, close: 7050,
      previousClose: 7000, changePercent: 50 / 7000,
    });
  });

  it("rejects non-positive closes and stale trade dates (never fabricates)", () => {
    expect(parsed.rejected).toEqual([
      { code: "IDXTECHNO", reason: "non-positive-close" },
      { code: "LQ45", reason: "date-mismatch" },
    ]);
  });

  it("throws on a malformed envelope rather than guessing", () => {
    expect(() => parseIdxIndexSummary({}, FIXTURE_DATE)).toThrow();
    expect(() => parseIdxIndexSummary({ data: [{ IndexCode: "X" }] }, FIXTURE_DATE)).toThrow(); // missing Date/Close
  });
});

describe("transport (injectable, unavailable by default)", () => {
  it("collectIndexSummary reports UNAVAILABLE when no authorized transport is configured", async () => {
    const result = await collectIndexSummary(unavailableIdxTransport(), FIXTURE_DATE);
    expect(result.status).toBe("UNAVAILABLE");
    if (result.status === "UNAVAILABLE") expect(result.reason).toMatch(/authorized/i);
  });

  it("collectIndexSummary parses whatever bytes an injected transport returns", async () => {
    const transport = { id: "fake", fetchIndexSummary: async () => ({ ok: true as const, body: IDX_INDEX_SUMMARY_FIXTURE }) };
    const result = await collectIndexSummary(transport, FIXTURE_DATE);
    expect(result.status).toBe("OK");
    if (result.status === "OK") expect(result.parse.rows).toHaveLength(2);
  });

  it("makeIdxIndexTransport is null when disabled and unavailable when enabled without an authorized transport", async () => {
    expect(makeIdxIndexTransport({ enabled: false, baseUrl: "https://www.idx.co.id/primary" })).toBeNull();
    const enabled = makeIdxIndexTransport({ enabled: true, baseUrl: "https://www.idx.co.id/primary" });
    expect(enabled).not.toBeNull();
    expect(await enabled!.fetchIndexSummary(FIXTURE_DATE)).toEqual({ ok: false, reason: expect.stringMatching(/authorized/i) });
  });

  it("exposes a stable source id", () => {
    expect(IDX_PRIMARY_SOURCE_ID).toBe("idx-primary");
  });
});
