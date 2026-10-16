// E3 parsers against trimmed real responses recorded on 2026-10-16 (test/fixtures/news-*.xml, bi-*.html; see README
// "Fixtures"), plus synthetic RSS/Atom variants for the edge cases the real feeds did not show.
import { describe, expect, it } from "vitest";
import { fixture } from "../../test/support";
import { BiTableError, parseBiRate, parseIndonesianDate, parseJisdor, parsePercent, parseRupiah } from "./bi";
import { canonicalUrl, matchSymbols, parseNewsFeed, SYMBOL_STOPLIST, titleKey } from "./news";
import { decodeEntities, FeedFormatError, parseFeed, parseFeedDate, stripHtml, summarize } from "./rss";

const FETCHED = new Date("2026-10-16T07:30:00Z"); // 14:30 WIB
const KNOWN = new Set(["BBCA", "BBRI", "GOTO", "TLKM", "BANK", "MEGA", "BUMI"]);

describe("RSS / Atom reader", () => {
  it("reads CNBC Indonesia's RSS 2.0 (CDATA titles, HTML descriptions, link after content:encoded)", () => {
    const entries = parseFeed(fixture("news-cnbcindonesia-market.xml"));
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      title: "Review MSCI Bikin IHSG Anjlok Hingga 11%, Dasco Ungkap Langkah OJK-BEI",
      link: "https://www.cnbcindonesia.com/market/20261016141345-17-776891/review-msci-bikin-ihsg-anjlok-hingga-11-dasco-ungkap-langkah-ojk-bei",
      date: "Fri, 16 Oct 2026 14:16:31 +0700",
    });
    expect(entries[0].description).toContain("<img");
  });

  it("reads Antara (media:title/media:description never shadow the item's own fields)", () => {
    const [first] = parseFeed(fixture("news-antara-bursa.xml"));
    expect(first.title).toBe("BEI minta investor tetap rasional dan lihat fundamental bursa RI");
    expect(stripHtml(first.description!)).toMatch(/^PT Bursa Efek Indonesia \(BEI\) mengingatkan/);
  });

  it("reads InvestorTrust's plain-text RSS with author and permalink guid", () => {
    const entries = parseFeed(fixture("news-investortrust-market.xml"));
    expect(entries.map((entry) => entry.date)).toEqual(["Fri, 16 Oct 2026 14:06:00 +0700", "Fri, 16 Oct 2026 13:26:00 +0700", "Fri, 16 Oct 2026 13:09:00 +0700"]);
    expect(entries[1].title).toBe("A Crisis of Trust: How an MSCI Demotion Threat Triggered a Friday Bloodbath in Jakarta");
  });

  it("reads Atom: alternate link, published before updated, summary but never content", () => {
    const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>X</title>
      <entry><title type="html">Saham &lt;b&gt;BBCA&lt;/b&gt; naik</title><link rel="self" href="https://x.test/self"/><link rel="alternate" href="https://x.test/a?utm_source=rss"/>
        <published>2026-10-16T09:00:00+07:00</published><updated>2026-10-16T10:00:00Z</updated><summary>Ringkas.</summary><content>Full body never read</content></entry>
      <entry><title>Only updated</title><link href="https://x.test/b"/><updated>2026-10-15T23:00:00Z</updated></entry>
    </feed>`;
    const entries = parseFeed(atom);
    expect(entries).toEqual([
      { title: "Saham BBCA naik", link: "https://x.test/a?utm_source=rss", date: "2026-10-16T09:00:00+07:00", description: "Ringkas." },
      { title: "Only updated", link: "https://x.test/b", date: "2026-10-15T23:00:00Z", description: null },
    ]);
  });

  it("falls back to a permalink guid, skips untitled items, ignores commented-out items", () => {
    const rss = `<rss version="2.0"><channel><title>T</title>
      <!-- <item><title>Hidden</title><link>https://x.test/hidden</link></item> -->
      <item><title>Guid only</title><guid isPermaLink="true">https://x.test/g</guid><dc:date>2026-10-16T08:00:00+07:00</dc:date></item>
      <item><title>Not a permalink</title><guid isPermaLink="false">abc-123</guid></item>
      <item><description>No title</description><link>https://x.test/n</link></item>
    </channel></rss>`;
    expect(parseFeed(rss)).toEqual([
      { title: "Guid only", link: "https://x.test/g", date: "2026-10-16T08:00:00+07:00", description: null },
      { title: "Not a permalink", link: null, date: null, description: null },
    ]);
  });

  it("rejects documents that are not feeds (e.g. an HTML error page with a 200)", () => {
    expect(() => parseFeed("<html><body>Maintenance</body></html>")).toThrow(FeedFormatError);
    expect(() => parseFeed('<rss version="2.0"></rss>')).toThrow(/channel/);
  });
});

describe("feed dates", () => {
  const iso = (text: string) => parseFeedDate(text)?.toISOString() ?? null;

  it("parses RFC 822 with numeric offsets, GMT/UTC, Indonesian zones and US zones", () => {
    expect(iso("Fri, 16 Oct 2026 14:16:31 +0700")).toBe("2026-10-16T07:16:31.000Z");
    expect(iso("Fri, 16 Oct 2026 07:16:31 GMT")).toBe("2026-10-16T07:16:31.000Z");
    expect(iso("16 Oct 2026 14:16 WIB")).toBe("2026-10-16T07:16:00.000Z");
    expect(iso("Jum, 16 Okt 2026 15:16:31 WITA")).toBe("2026-10-16T07:16:31.000Z");
    expect(iso("Thu, 15 Oct 2026 20:00:00 EDT")).toBe("2026-10-16T00:00:00.000Z");
    expect(iso("Fri, 16 Oct 26 14:16:31 +0700")).toBe("2026-10-16T07:16:31.000Z");
    expect(iso("Sat, 16 Mei 2026 14:16:31 -0130")).toBe("2026-05-16T15:46:31.000Z");
  });

  it("parses ISO 8601 and reads a date without a zone as WIB", () => {
    expect(iso("2026-10-16T14:16:31+07:00")).toBe("2026-10-16T07:16:31.000Z");
    expect(iso("2026-10-16T07:16:31.250Z")).toBe("2026-10-16T07:16:31.000Z");
    expect(iso("2026-10-16 14:16:31")).toBe("2026-10-16T07:16:31.000Z");
    expect(iso("Fri, 16 Oct 2026 14:16:31")).toBe("2026-10-16T07:16:31.000Z");
    expect(iso("2026-10-16")).toBe("2026-10-15T17:00:00.000Z");
  });

  it("returns null for unknown zones, impossible dates and junk", () => {
    expect(parseFeedDate("Fri, 16 Oct 2026 14:16:31 XYZ")).toBeNull();
    expect(parseFeedDate("31 Feb 2026 10:00:00 +0700")).toBeNull();
    expect(parseFeedDate("2026-02-30T10:00:00Z")).toBeNull();
    expect(parseFeedDate("kemarin sore")).toBeNull();
    expect(parseFeedDate("")).toBeNull();
    expect(parseFeedDate(null)).toBeNull();
  });
});

describe("text helpers", () => {
  it("strips tags, scripts and comments, decodes entities once, collapses whitespace", () => {
    expect(stripHtml(' <img src="x.jpg"/> Laba <b>naik</b>&nbsp;10%<script>alert(1)</script><!-- c -->\n\n  tahun ini ')).toBe("Laba naik 10% tahun ini");
    expect(stripHtml("Kode &lt;script&gt; tetap teks &amp; aman")).toBe("Kode <script> tetap teks & aman");
    expect(decodeEntities("&#8220;IHSG&#x201D; &hellip; &unknown;")).toBe("“IHSG” … &unknown;");
  });

  it("summarizes to at most 280 characters at a word boundary", () => {
    const long = `<p>${"kata ".repeat(100)}</p>`;
    const summary = summarize(long)!;
    expect(summary.length).toBeLessThanOrEqual(280);
    expect(summary.endsWith("kata…")).toBe(true);
    expect(summarize("<p>Pendek.</p>")).toBe("Pendek.");
    expect(summarize("<img src='x'/>")).toBeNull();
    expect(summarize(null)).toBeNull();
  });

  it("canonicalizes links and title keys for dedupe", () => {
    expect(canonicalUrl("https://WWW.Example.TEST/a/b/?utm_source=rss&utm_medium=feed&id=7#top")).toBe("https://www.example.test/a/b?id=7");
    expect(canonicalUrl("http://investortrust.id/market/1/x")).toBe("http://investortrust.id/market/1/x");
    expect(canonicalUrl("https://x.test/?utm_campaign=a")).toBe("https://x.test/");
    expect(canonicalUrl("javascript:alert(1)")).toBeNull();
    expect(canonicalUrl("https://user:pw@x.test/a")).toBeNull();
    expect(canonicalUrl("not a url")).toBeNull();
    expect(titleKey("IHSG “Anjlok” 11%: Saham-saham Café!")).toBe("ihsg anjlok 11 saham saham cafe");
  });
});

describe("symbol matching", () => {
  it("matches known $SYMBOL and bare upper-case tickers, never unknown codes", () => {
    expect(matchSymbols("Asing borong BBCA dan $tlkm, jual GOTO; ABCD naik", KNOWN)).toEqual(["BBCA", "GOTO", "TLKM"]);
    expect(matchSymbols("Saham bbca naik", KNOWN)).toEqual([]);
    expect(matchSymbols("BBCA-W dan BBCA2 bukan saham induk", KNOWN)).toEqual([]);
  });

  it("ignores stoplisted words unless written as $SYMBOL, and ignores bare tickers in all-caps text", () => {
    expect(SYMBOL_STOPLIST.has("BANK")).toBe(true);
    expect(matchSymbols("Kinerja BANK dan MEGA proyek naik", KNOWN)).toEqual([]);
    expect(matchSymbols("Saham $BANK melonjak", KNOWN)).toEqual(["BANK"]);
    expect(matchSymbols("IHSG ANJLOK, BBCA DAN BUMI TERTEKAN", KNOWN)).toEqual([]);
    expect(matchSymbols("IHSG ANJLOK, $BBCA TERTEKAN", KNOWN)).toEqual(["BBCA"]);
    expect(matchSymbols("MSCI dan IHSG", new Set(["MSCI", "IHSG"]))).toEqual([]);
  });
});

describe("news feed items", () => {
  it("keeps headline, canonical link, time, outlet and a plain summary only from the feed's description", () => {
    const { items, skipped } = parseNewsFeed(fixture("news-cnbcindonesia-market.xml"), { outlet: "CNBC Indonesia" }, FETCHED, KNOWN);
    expect(skipped).toBe(0);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      url: "https://www.cnbcindonesia.com/market/20261016141345-17-776891/review-msci-bikin-ihsg-anjlok-hingga-11-dasco-ungkap-langkah-ojk-bei",
      title: "Review MSCI Bikin IHSG Anjlok Hingga 11%, Dasco Ungkap Langkah OJK-BEI",
      titleKey: "review msci bikin ihsg anjlok hingga 11 dasco ungkap langkah ojk bei",
      publishedAt: new Date("2026-10-16T07:16:31Z"),
      publishedAtEstimated: false,
      summary: "Wakil Ketua DPR Sufmi Dasco Ahmad menanggapi anjloknya IHSG hingga 11% akibat laporan MSCI. DPR akan terus awasi dan dorong perbaikan di pasar modal.",
      outlet: "CNBC Indonesia",
      symbols: [],
    });
    for (const item of items) expect(item.summary === null || (item.summary.length <= 280 && !item.summary.includes("<"))).toBe(true);
  });

  it("parses every recorded feed", () => {
    for (const name of ["news-detik-finance.xml", "news-antara-bursa.xml", "news-investortrust-market.xml", "news-investortrust-macro.xml"]) {
      const { items } = parseNewsFeed(fixture(name), { outlet: "x" }, FETCHED, KNOWN);
      expect(items, name).toHaveLength(3);
      expect(items.every((item) => !item.publishedAtEstimated && item.publishedAt <= FETCHED && /^https?:\/\//.test(item.url)), name).toBe(true);
    }
  });

  it("falls back to the fetch time (flagged) for missing, unparseable or far-future dates; drops in-feed repeats", () => {
    const rss = `<rss version="2.0"><channel><title>T</title>
      <item><title>Tanpa tanggal $BBCA</title><link>https://x.test/1</link><description>Tanpa tanggal $BBCA</description></item>
      <item><title>Masa depan</title><link>https://x.test/2</link><pubDate>Fri, 16 Oct 2026 23:00:00 +0700</pubDate></item>
      <item><title>Masa depan!</title><link>https://x.test/3</link></item>
      <item><title>Ulang</title><link>https://x.test/1?utm_source=a</link></item>
      <item><title>Bukan http</title><link>ftp://x.test/4</link></item>
    </channel></rss>`;
    const { items, skipped } = parseNewsFeed(rss, { outlet: "T" }, FETCHED, KNOWN);
    expect(items.map((item) => [item.title, item.publishedAt.toISOString(), item.publishedAtEstimated, item.summary, item.symbols])).toEqual([
      ["Tanpa tanggal $BBCA", FETCHED.toISOString(), true, null, ["BBCA"]],
      ["Masa depan", FETCHED.toISOString(), true, null, []],
    ]);
    expect(skipped).toBe(3);
  });
});

describe("Bank Indonesia tables", () => {
  it("parses the BI-Rate table (a commented-out column does not shift the cells)", () => {
    expect(parseBiRate(fixture("bi-rate.html"))).toEqual([
      { series: "BI_RATE", date: "2026-09-23", value: 5.75, link: "https://www.bi.go.id/id/publikasi/ruang-media/news-release/Pages/sp_2819326.aspx" },
      { series: "BI_RATE", date: "2026-08-19", value: 5.75, link: "https://www.bi.go.id/id/publikasi/ruang-media/news-release/Pages/sp_2816226.aspx" },
      { series: "BI_RATE", date: "2026-07-22", value: 5.75, link: "https://www.bi.go.id/id/publikasi/ruang-media/news-release/Pages/sp_2814226.aspx" },
    ]);
  });

  it("parses the JISDOR table in the Indonesian number format", () => {
    expect(parseJisdor(fixture("bi-jisdor.html"))).toEqual([
      { series: "JISDOR", date: "2026-10-15", value: 17948, link: null },
      { series: "JISDOR", date: "2026-10-14", value: 17898, link: null },
      { series: "JISDOR", date: "2026-10-13", value: 17930, link: null },
    ]);
  });

  it("fails loudly when the page changes (no table, bad rows, implausible values)", () => {
    expect(() => parseJisdor("<html><body>Sedang pemeliharaan</body></html>")).toThrow(BiTableError);
    expect(() => parseJisdor(fixture("bi-rate.html"))).toThrow(/Kurs/);
    expect(() => parseJisdor(fixture("bi-jisdor.html").replace("Rp17.948,00", "n/a"))).toThrow(/Unexpected JISDOR row/);
    expect(() => parseJisdor(fixture("bi-jisdor.html").replace("Rp17.948,00", "Rp17,94"))).toThrow(/out of range/);
    expect(() => parseBiRate(fixture("bi-rate.html").replace("5.75 %", "57.5 %"))).toThrow(/out of range/);
  });

  it("reads Indonesian dates, rupiah and percentages", () => {
    expect(parseIndonesianDate("15 Oktober 2026")).toBe("2026-10-15");
    expect(parseIndonesianDate("9 Agu 2026")).toBe("2026-08-09");
    expect(parseIndonesianDate("31 Februari 2026")).toBeNull();
    expect(parseIndonesianDate("October 15, 2026")).toBeNull();
    expect(parseRupiah("Rp17.948,00")).toBe(17948);
    expect(parseRupiah("Rp 16.250,50")).toBe(16250.5);
    expect(parseRupiah("17948")).toBe(17948);
    expect(parseRupiah("17,948.00")).toBeNull();
    expect(parsePercent("5.75 %")).toBe(5.75);
    expect(parsePercent("5,75%")).toBe(5.75);
    expect(parsePercent("5.75")).toBeNull();
  });
});
