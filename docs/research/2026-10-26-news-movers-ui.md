# News, calendar and movers UI research (2026-10-26)

Scope: how strong products present (a) market news and corporate-action calendars, (b) top movers and market-cap rankings, and what HAKAPRO adopts. Findings are patterns only; no assets or text were copied.

**Evidence quality, stated honestly.** Web search was US-only and several product pages were blocked or empty (Yahoo's screener pages returned error shells; Ajaib's feature page returned HTTP 403; no usable pages found for Stockbit, Google Finance or Robinhood). Where a product could not be verified, the pattern below is marked "general convention" and rests on common knowledge of these products, not on a fetched page.

## Sources used

- Ajaib, Corporate Action feature and daily cum-date articles (search snippets, page blocked): https://ajaib.co.id/belajar/fitur-update/pantau-jadwal-dividen-stock-split-right-issue-fitur-corporate-action and https://ajaib.co.id/belajar/berita/saham-yang-cum-date-hari-ini-7-juli-2026
- TradingView dividend calendar support page: https://www.tradingview.com/support/solutions/43000759913/
- Finviz maps (size by market cap, color by performance; color depth = magnitude): https://finviz.com/blog/new-stock-market-maps-for-market-cap-52-week-highs-lows-themes-and-insider-trading and https://finviz.com/blog/the-finviz-matrix-market-breadth-visualized/
- Yahoo Finance screener entries (Most active, Day gainers, Day losers as peer lists): https://finance.yahoo.com (navigation only; layout not verifiable)
- Stockbit education article on cum date (no calendar feature page found): https://snips.stockbit.com/investasi/kapan-terakhir-beli-saham-agar-dapat-dividen

## (a) News feeds and calendars

| Pattern | Seen in | Decision |
|---|---|---|
| Feed grouped by day with a relative label ("Today", "Yesterday") | General convention (news apps, Yahoo/Google style feeds) | Adopt, sticky day headers with item count |
| Outlet name/monogram beside a relative timestamp, absolute time on hover | General convention | Adopt; outlet derived from the article URL host (the feed has no source field), absolute date in `title`/`<time>` |
| Large first headline, compact rest | General convention | Adopt for the first item only ("Terbaru" tag), others stay two-line |
| Related-ticker chips linking to the stock page | Yahoo, TradingView (ticker drill-down) | Adopt, rendered only when the feed provides `symbols` (schema field added as optional; the current provider does not send it, so chips appear once it does) |
| Dividend calendar with amount and ex-date per company; ticker click opens the stock | TradingView page | Adopt: amount is the largest number on the row, ticker links to `/stock/{symbol}` |
| One agenda for dividend, split and other actions with cum/ex/record/payment dates | Ajaib Terminal Corporate Action | Partly: our data has only the ex-date, so we show type chips, ex-date headers and a countdown, not the other dates |
| Week/date strip showing which days have events | General calendar convention | Adopt as a 7-day strip (current week, counts as dots, anchors to the agenda) |
| Full month grid | Calendar apps | Reject: sparse data, large footprint on mobile |
| Sun/moon pre/post-market icons | TradingView earnings | Reject: no such data |
| Skeletons that mirror the final rows | General convention | Adopt |

## (b) Movers and market-cap rankings

| Pattern | Seen in | Decision |
|---|---|---|
| Three peer lists (gainers, losers, most active) | Yahoo screeners, Robinhood/Webull movers | Already present; restyled as a pill segmented control |
| Change as a colored pill with arrow and sign | General convention | Adopt, using the market tokens only (brand teal is never a market color); arrow and sign always shown |
| Size/area encodes magnitude, color encodes direction, deeper tint = bigger move | Finviz | Adopt in light form: row tint tier by absolute change plus an inline value bar; never color alone |
| Breadth as one proportion bar | Finviz Matrix idea (breadth visualized) | Adopt: advancers / unchanged / decliners strip with counted labels and a text equivalent |
| Sparklines per row | Google/Robinhood | Reject: the session list carries no intraday series; no invented data |
| Sticky column header, dense rows | Terminals (Bloomberg-style) | Adopt on desktop; under 640px rows become two-line cards, no horizontal scroll |
| Rank bar relative to the leader | General convention | Adopt for market caps (relative to the largest on the current page, stated in a hint) |
| Sector chips linking to the map | Finviz sector grouping | Adopt as a small strip using the sectors endpoint, shown only when data exists |
| Heatmap as the main view | Finviz | Reject here: it already exists as "Peta Pasar"; the strip links to it |

## Design notes carried into the build

- Hierarchy: ticker and headline first, then numbers in tabular figures, metadata smallest.
- Every direction cue has a glyph and a sign; tints are decoration.
- Touch targets are at least 40px on mobile (chips, tabs, pagination, links).
- Motion: no new animation was added, so `prefers-reduced-motion` is respected by construction.
