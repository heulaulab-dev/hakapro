# HAKAPRO mobile-first UI audit (2026-10-26)

Scope: every route group, fixture mode (`MARKET_DATA_SOURCE=fixture`, dev auth bypass), Playwright screenshots at 360x740, 390x844, 768x1024 and 1440x900, light and dark, plus DOM metrics (sideways overflow, touch-target boxes, input font size) at every size. `discover/movers` and `news` are being redone on `feat/ui-news-movers` and were only observed (movers: date input 12px, 28px chips; news: tab links 35x45), not changed. Engine-only panels show `UNSUPPORTED` in fixture mode; those states were judged too (they were tall and low-density, see M7).

Method note: the app scrolls inside `<main>` (body is `overflow-hidden`, `h-dvh`), so `document.documentElement.scrollWidth` can never fail. The new mobile spec checks `main` and every element's right edge instead.

## Blockers

| # | Route @ viewport | Finding | Fix | Status |
|---|---|---|---|---|
| B1 | `/stock/BBCA/flow` @360, 390 | Page scrolls sideways by 265px / 235px. A grid child (`broker-levels` table) without `min-w-0` stretched its column to 625px | `grid-cols-1` (= `minmax(0,1fr)`) on every `grid gap-*` that only switches columns at `lg`; applied in 9 views | Fixed |
| B2 | `/research/BBCA` @360, 390 | +49px / +19px: status badges in a Panel header (`shrink-0`) | `Panel` header and actions wrap | Fixed |
| B3 | `/stock/BBCA/chart` @360 | +4px: indicator + range toggles in one non-wrapping row | same Panel fix | Fixed |
| B4 | landing `/` @360 | Header CTA "Buka HAKA PRO" clipped at the right edge (not caught by the old 412px test) | symbol logo under `sm`, wordmark from `sm` | Fixed |
| B5 | all touch screens | Controls 24-34px (buttons 30px, toggle pills 28px, selects/inputs 32px, tab links, icon buttons). 238 sub-40px boxes across 29 routes at 360 | `@media (pointer: coarse)` 40px minimum for buttons, tabs, selects, inputs and `a[data-slot=button]`; checkbox/switch keep their look but get a 24px-wider hit area; inline links get `touch-target` | Fixed (161 left, all skip-links, padded freshness dots, tab links 45px tall) |
| B6 | every `FreshnessBadge` on touch | The as-of/period/source details were a hover tooltip: Radix tooltips never open on touch, so the date of a number was unreachable on phones | coarse pointer renders the same details in a tap popover (button, 40px padded hit area) | Fixed |
| B7 | `/stock/BBCA/history`, `/screener`, strategy detail, insiders, flow tables @360 | 6-9 column tables show 2-3 columns; the rest sit behind a sideways swipe inside a card | `DataTable mobile="cards"` (auto layout or `renderCard`), sort select, "show N more"; holders table drops the as-of column into the cell | Fixed for 7 tables; see Next for the rest |
| B8 | inputs @360 | 14px / 12px inputs trigger iOS Safari page zoom on focus (9 inputs on 6 routes) | coarse pointer sets 16px on input/select/textarea | Fixed |
| B9 | `/stock/BBCA/chart` all touch | lightweight-charts default `vertTouchDrag` captures vertical swipes, so a finger on the chart does not scroll the page | `handleScroll.vertTouchDrag: false` | Fixed |

No content was found hidden behind the bottom nav: it is a flex sibling of `<main>` (not `position: fixed`), uses `env(safe-area-inset-bottom)`, and the new spec asserts `main` ends above it.

## Major

| # | Finding | Fix | Status |
|---|---|---|---|
| M1 | Stock header scrolled away; deep tabs lost ticker/price; price, change and freshness only, no turnover/volume | `StockChrome`: header + stat strip (value, volume in lots, foreign net, day range) that fits above the fold at 360x740; sticky tabs with a one-line quote that appears when the header leaves. Tab strip scrolls the active tab into view with snap | Fixed |
| M2 | Screener builder: 5 controls per condition wrapped on a phone, results pushed below the fold | Bottom `FilterSheet` on phones (summary chips + "Filter" in the thumb zone), stacked condition rows, sticky "Show results" | Fixed |
| M3 | Heatmap: five wrapped toggle groups = 1.3 screens of controls before any data | `ChipBar`: one snap-scrolling row with edge fade | Fixed |
| M4 | Home: market condition first, watchlist/movers (what a trader checks first) buried 3-4 screens down | Phone-only `order`: indices and breadth, watchlist, movers, strategies, condition, sectors, news; desktop untouched | Fixed |
| M5 | `MetricCard` truncated numbers ("176,75 jt lemb...") and repeated a 90px freshness pill 4x | numbers wrap, badge becomes a dot on phones (label kept for screen readers and the tap details) | Fixed |
| M6 | Perceived speed: no `loading.tsx` anywhere (old page frozen while the server renders), chart libs in the main chunk | `RouteLoading` skeleton on 11 routes (not on routes that call `notFound()`, since streaming would turn their 404 into 200); lightweight-charts and recharts lazy-loaded with same-height skeletons | Fixed |
| M7 | Empty/UNSUPPORTED states: 220px tall, title line-height 1 so two-line messages touch | `EmptyState` compact is 24px shorter on phones, `leading-snug` | Fixed |
| M8 | Statement table label column 224px of 328px | 160px on phones, 2-line labels | Fixed |
| M9 | No offline state | `OfflineBanner` (offline / back online); react-query already pauses and refetches on reconnect | Fixed |
| M10 | Bottom nav: 16px icons, colour-only active state, More never active | 20px icons, 2px active bar, More lights up for non-primary pages | Fixed |
| M11 | Treemap on phone is a 640px canvas behind a sideways scroll; palette results show no price | not done | Next |

## Minor / checks

- Safe areas: viewport had no `viewport-fit=cover`; added it plus `env(safe-area-inset-*)` body padding (sheet footers already pad the bottom). `100vh`: none used; `h-dvh` and `max-h-[85dvh]` are correct.
- Tap feedback: added `-webkit-tap-highlight-color: transparent`, `touch-action: manipulation` (no 300ms delay) and a pressed state on touch (`:active` opacity). Overscroll: `overscroll-behavior-y: contain` on `main` and the marketing scroller.
- Tabular numerals: `.ticker`/`.num` already set `tabular-nums` on prices; fine. Number density: compact IDR/lot formats are used in lists; headers now use lots (IDX convention) instead of "lembar" to save 40% width.
- `inputMode`: only the screener value uses `decimal`. Still missing: watchlist add (text/uppercase: `autoCapitalize="characters"`, `autoCorrect="off"`), heatmap/ownership search (`type=search`), alerts thresholds. Next.
- Reduced motion: no rule existed (skeleton pulse, LIVE dot, sheet slides). Added a global `prefers-reduced-motion` reset.
- Dev-only: the Next "N" indicator overlaps the bottom nav in screenshots; fixture banner adds 24px. Neither ships.
- Copilot drawer (`AI_FEATURES_ENABLED` off) could not be rendered; by code it is a right-hand `Sheet` (560px, `w-full` under `sm`), so it already fills the phone; worth one manual pass.
- Colour: market colours unchanged (brand teal stays off market semantics); light and dark both screenshotted at all sizes; no contrast regressions seen (stat-strip uses existing tokens).

## Bundle sizes (`next build`, Turbopack; gzip of every chunk in the route's client manifest)

Turbopack prints no per-route sizes, so these come from `.next/server/app/**/page_client-reference-manifest.js`.

| Route | Before | After |
|---|---|---|
| stock/flow | 406 KB | 299 KB |
| stock/financials | 377 KB | 276 KB |
| stock overview | 325 KB | 276 KB |
| stock/chart | 323 KB | 275 KB |
| dashboard | 284 KB | 288 KB |
| screener | 286 KB | 290 KB |
| methodology (smallest app route) | 258 KB | 261 KB |

Every app route carries a ~258 KB gzip floor: three chunks of 104 KB (recharts), 89 KB (zod and shared client libs: the auth/schemas imports are the likely offender) and 54 KB (lightweight-charts), plus Radix/next-intl. Lazy loading moves the charts off the critical path of flow, financials, overview and chart. The +3-4 KB elsewhere is the new popover/sheet/cards code. Biggest remaining offenders: the 89 KB shared chunk (it ships `zod` to every route: share parsing server-side or use `zod/mini`), recharts still inside `ui/chart.tsx`, `/dev/primitives` (dev only).

## What good mobile trading UIs do (adopted vs not)

Sources I could verify: [Deliveroo design system: tab bars become part of the sticky header on scroll](https://design.deliveroo.net/components/pds/bars); [financial UI patterns (bottom sheets, sticky headers, responsive tables)](https://skillsmp.com/creators/rgourley/financial-ui-suite/skills-financial-ui-patterns); [CMC Markets moved main features into a bottom bar](https://cmcmarkets.com/en-ca/platform/new-platform-features/navigation); [trading app design write-up](https://lollypop.design/blog/2026/june/trading-app-design/?p=25070); [Material 3 bottom sheets](https://m3.material.io/components/bottom-sheets/overview); [Apple HIG tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars); [WCAG 2.2 target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html); [lightweight-charts `HandleScrollOptions`](https://tradingview.github.io/lightweight-charts/docs/api/interfaces/HandleScrollOptions). Web search returned no reviews of Stockbit, Ajaib or Robinhood UIs; what follows about them is general product familiarity, not a verified citation.

| Pattern | Seen in | Verdict |
|---|---|---|
| Bottom tab bar, 3-5 items, search in reach | Stockbit, Robinhood, Yahoo Finance, CMC | Already present; strengthened |
| Sticky price header that collapses to ticker + price | Robinhood, Yahoo Finance, TradingView | Adopted (`StockChrome`) |
| Horizontally scrollable chip filters | Stockbit, Yahoo Finance screeners | Adopted (`ChipBar`) |
| Bottom sheet for filters | Material 3, Ajaib/Stockbit screeners | Adopted (`FilterSheet`, screener) |
| Cards instead of wide tables, sort via a picker | Yahoo Finance, Robinhood lists | Adopted (`DataTable mobile="cards"`) |
| Swipeable tabs between sections | TradingView, Yahoo Finance | Not adopted: route tabs are URLs and swipe conflicts with the horizontal chart pan; tab strip scrolls and snaps instead |
| Pull-to-refresh | all of the above | Not adopted: the shell scrolls inside `<main>` and data is mostly EOD; add with a manual refresh button first (Next) |
| Compact sparklines per row | Robinhood, Stockbit watchlist | Next (needs a batched intraday/EOD series endpoint) |

## Next (prioritised)

1. Mobile treemap: sector-grouped list (or pulse view) as the phone default; keep the canvas for tablet+.
2. Palette stock results with last price and change; recent symbols on empty input.
3. Cards for the remaining wide tables: research flow windows, broker levels ladder, analysis patterns, `discover/ownership`, `stealth`, groups.
4. Watchlist: inline price/change/value rows with sparkline, swipe-to-remove, `autoCapitalize="characters"`/`inputMode`; thousand separators in numeric filter inputs.
5. Pull-to-refresh plus a "last updated" pill that refetches the page's queries.
6. Cut the 89 KB shared chunk (zod on the client) and `ui/chart.tsx`/recharts; service-worker cache for the last-viewed stock (true offline reading).
7. Run the same `mobile.spec.ts` against the redone news/movers once `feat/ui-news-movers` lands (add their routes; both already pass the overflow check today).
8. Extend `loading.tsx` to `research/[code]`, `strategies/[id]` and `admin` by catching invalid ids in the layout instead of the page (so a 404 keeps its status).

## Before / after (360x740, dark)

`assets/mobile-audit-stock-before.png` vs `mobile-audit-stock-sticky-after.png` (header stats, sticky tabs and quote), `mobile-audit-heatmap-before.png` vs `mobile-audit-heatmap-after.png` (one chip row), `mobile-audit-history-before.png` vs `mobile-audit-history-after.png` (cards), `mobile-audit-screener-sheet-after.png` (bottom sheet).
