import { describe, expect, it } from "vitest";
import actions from "./fixtures/idx-corporate-actions.json";
import news from "./fixtures/idx-news-search.json";
import announcements from "./fixtures/idx-announcements.json";
import { IDX_CA_TYPES, idxActionParams, parseIdxActions, parseIdxAnnouncements, parseIdxNews } from "./idx-disclosures";

describe("IDX disclosures and news contracts", () => {
  it("maps all IDX corporate action categories and retains original category", () => {
    expect(IDX_CA_TYPES).toHaveLength(15);
    const parsed = parseIdxActions(actions, "tanpaHmetd");
    expect(idxActionParams("tanpaHmetd", 0)).toMatchObject({ caType: "tanpaHmetd", start: 0, length: 9999 });
    expect(parsed.rows[0]).toMatchObject({ symbol: "UNSP", exDate: "2026-08-04", type: "NON_RIGHTS_ISSUE", sourceCategory: "tanpaHmetd" });
    expect(parsed.complete).toBe(true);
  });
  it("normalizes IDX news into the existing news contract with official URLs", () => {
    const parsed = parseIdxNews(news, new Date("2026-10-28T00:00:00Z"), new Set(["ASPR"]));
    expect(parsed[0]).toMatchObject({ url: "https://www.idx.co.id/api/api/publication/news/11259", outlet: "IDX", symbols: ["ASPR"], publishedAtEstimated: false });
    expect(parsed[0].summary).toBeNull();
  });
  it("trims announcement codes and accepts only official HTTPS attachment URLs", () => {
    const parsed = parseIdxAnnouncements(announcements);
    expect(parsed[0]).toMatchObject({ externalId: "20261022115833-122/LBB/X/2026_id-id", symbol: "STRK", title: "Pengumuman Negosiasi sehubungan dengan Rencana Pengambilalihan PT Lovina Beach Brewery Tbk" });
    expect(parsed[0].documentUrl).toMatch(/^https:\/\/www\.idx\.co\.id\//);
    const invalid = parseIdxAnnouncements({ Items: [{ ...announcements.Items[0], Attachments: [{ FullSavePath: "https://evil.test/file.pdf" }] }] });
    expect(invalid[0].documentUrl).toBeNull();
  });
});
