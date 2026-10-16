# Custom strategy rules (HAKA-17)

Status: **DRAFT v0.1, awaiting owner approval.** Nothing in this document is implemented. No strategy
code is written until the owner approves or corrects each section (§4–§9), and answers the questions marked
**Q**. Every default value below is a proposal, not a decision.

Date: 2026-10-16. Plane: HAKA-17 (this spec). Consumers: HAKA-18 (Strategy Engine contract), HAKA-25 (IDX
price-limit and tick-size rules), HAKA-14/15 (Running Trade gateway, Phase 2).

Scope: BREAKOUT, BB REVERSAL, HAKA PAGI, SCALPING INTRADAY, HAKA SORE/BSJP and ARA HUNTER. **Akumulasi Senyap
stays provider-defined for V1.** It is still read from arjum `/api/screener/latest` and parsed by
`src/server/services/why-matched.ts`. It is not redefined here.

Sources checked:

- HAKAPRO `docs/MIGRATION.md` (§9.5 wording, §10 provider conduct, §11 arjum coverage), `docs/PROGRESS.md`,
  `docs/features/CONNECTION-NETWORK.md` (Data Engine), `src/server/market/{types,source}.ts`,
  `src/server/services/{arjum-normalize,why-matched,analysis-parse}.ts`,
  `src/server/config/{idx-calendar,reporting}.ts`, `src/lib/api/provider-limits.ts`, `src/lib/freshness`.
- The HeulaTrade repo (`~/kiyadev/heulaulab/heulatrade`, read-only). **It holds no definition of any of the
  six strategies.** The only hits:
  - `HeulaTrade-PRD.md` §37 lists "Volume breakout" and "Price breakout" as technical screener fields, with
    no formula.
  - A terminal layout preset is called "Tape & Scalping" (`stores/terminal-store.ts:38`). It is UI only.
  - The Running Trade normalizer (`lib/market/arjum/websocket.ts`) documents the Phase 2 message shapes
    used in §2.3.
- The arjum screener fixtures contain only the provider buckets AKUMULASI SENYAP, KONFLIK DISTRIBUSI and
  RISIKO PANTULAN. **None of the six names is a provider bucket.** These are HAKAPRO's own definitions.

No provider or website was called to write this document. All examples are synthetic.

---

## 1. Summary

| Strategy | EOD feasible now? | Blocked by | Confidence in proposed definition |
|---|---|---|---|
| BREAKOUT | **Yes, per symbol.** Daily history is enough. A universe-wide scan is not (§2.4) | Universe source (§2.4). HAKA-25 only for the `atUpperLimit` flag | **Medium-high.** Standard N-day high with volume confirmation. The choice of parameters is the owner's |
| BB REVERSAL | **Yes, per symbol.** Universe scan same as above | Universe source (§2.4) | **Medium.** "Reversal" could mean several things. Assumed: long side, close back inside the lower band |
| HAKA PAGI | **No.** It needs the morning trade tape with an aggressor side | HAKA-14/15 Running Trade (live). HAKA-25 (ARA exclusion) | **Low-medium.** The name is interpreted (assumption) |
| SCALPING INTRADAY | **Live: no.** An **EOD pre-filter** ("scalping watchlist") is feasible per symbol | HAKA-14/15 (live), HAKA-25 (tick size, required) | **Low.** Scalping is a trading style, not a pattern. The proposal is a liquidity and volatility filter |
| HAKA SORE / BSJP | **EOD variant: yes, per symbol**, once HAKA-25 exists. The live variant needs the tape | HAKA-25 (at-limit exclusion), HAKA-14/15 (live variant) | **Medium.** The name is interpreted. The EOD variant is a historical record, not an actionable list (§8) |
| ARA HUNTER | **EOD: yes, per symbol, after HAKA-25.** It cannot be approximated before that | **HAKA-25 (hard dependency).** Board/notation data. HAKA-14/15 for intraday | **Medium.** "At the upper auto-rejection limit" is crisp. "Hunter" (near-limit, streaks) is the owner's choice |

"Per symbol" means the rule can run on the history HAKAPRO already fetches for one stock, or for a small
user-chosen list such as a watchlist. A scan of all ~955 listed stocks has no compliant data source today
(§2.4). That is the main business decision behind this ticket (Q-G1).

---

## 2. Data HAKAPRO actually has

### 2.1 Available today (arjum lane, `MarketDataSource`)

| Input | Capability / type | Notes for strategies |
|---|---|---|
| Daily OHLCV + value + frequency + foreign buy/sell | `history(symbol, {limit 20–500, frame})` → `HistoryRow` | Sorted ascending. **One symbol per call.** Corporate-action adjustment is `TODO(verify)` (Q-G5) |
| Listed range | `History.available.from` | Used for the IPO lookback |
| Today's last price and running totals | `price(symbol)` → `LastPrice` | DELAYED during a session, never LIVE. This is a snapshot, not a tick stream |
| Historical trade tape (time, board RG/NG, price, lots, value, buyer/seller broker and type, `action` BUY/SELL = aggressor) | `doneDetails(symbol, {date, page ≤100/page})` | **Not usable for scans.** BBCA had 715,971 trades (7,160 pages) on 2026-10-02. It is usable only to build test fixtures for one illiquid symbol and one day |
| Broker summary / accumulation | `brokerSummary`, `brokerAccumulation` | Optional context. No strategy here requires it |
| Market cap, close, listed shares, turnover ratio for **all** stocks on a date | `marketCap({date, page, perPage ≤50})` | About 20 pages per date. It has no OHLV. See §2.4 |
| Provider analysis (RSI, SMA, Bollinger as numbers) | `analysis(symbol)` | **Not an engine input.** HAKAPRO computes its own indicators from `history`. The provider's numbers may only be used as a cross-check in a manual review |
| Seasonality, financials, insiders | existing capabilities | Not used by these six strategies |

### 2.2 idx-bei lane (`MARKET_API_URL`, **not configured anywhere**)

`stock(symbol)` has quote and candles. `securities()` returns `Security.board`. `/v1/screener` covers price,
volume, value, frequency, foreignNetShares, marketCap, ratios and change1D. `corporateActions()`. These would
give the board, corporate-action dates and a universe-wide one-day pre-filter. The lane is unconfigured, and
the origin and terms of its data are open (MIGRATION §10.4, CONNECTION-NETWORK "Data Engine inputs").

### 2.3 Phase 2 Running Trade (HAKA-14/15, not deployed)

Message shapes from the HeulaTrade normalizer:

- `snapshot`: market status, session status, recent trades.
- `trade`: time, symbol, action, price, lots, value, priceChange, tradeNumber.
- `top5`: **the five most active symbols by value. This is not an order book.**

Consequences:

- **No order-book depth exists anywhere.** Bid/offer queues are unavailable. "Antrian ARA" (queue at the
  upper limit) is unavailable.
- The trade message has **no board field**. Negotiated-market trades cannot be excluded unless the gateway
  adds the board (`TODO(verify)` in HAKA-15).
- `action` is assumed to be the aggressor side (BUY = the buyer lifted the offer = "haka"), as in
  done-details. `TODO(verify)` in HAKA-15.

### 2.4 Universe-wide scanning (the main gap)

Running a strategy over every listed stock needs daily bars for about 955 symbols per session.

| Option | Calls per session | Status under MIGRATION §10 |
|---|---|---|
| arjum `history` per symbol | ~955 plus the symbol list | **Crawling.** Not allowed without a Data Engine decision. The daily quota is unknown |
| arjum `marketCap` by date (closes for all stocks) | ~20 per date, so ~40 for t and t−1 | Gives close and turnover only. Enough for a **close-based ARA pre-filter**, nothing else. Still a paged sweep: needs an owner decision |
| idx-bei lane (own Python service over idx-bei snapshots) | 1 screen request + per-symbol candles | Unconfigured. Data origin and terms are unresolved |
| A licensed EOD feed in a Data Engine | — | Not started (CONNECTION-NETWORK §6) |
| **Bounded user universe**: watchlist or a user-chosen list, ≤ 50 symbols (proposal) | ≤ 50 `history` calls, on a user action, cached per session | **Allowed today** (§10.1: needed by a user action) |

**Proposal for V1:** run the EOD strategies on a bounded user universe (watchlist, or symbols pasted by the
user, ≤ 50) until a Data Engine provides universe-wide EOD bars. Q-G1.

---

## 3. Common definitions (apply to every strategy)

### 3.1 Notation

- `t` = the evaluation session (a trading date). `t−1` = the previous trading session in the provider's
  rows. It is not the previous calendar day.
- `O, H, L, C, V, Val, F` = open, high, low, close (IDR), volume (shares), value (IDR), frequency (trades).
- `prevClose = C[t−1]`. Phase 1 uses this as a proxy for the exchange reference price. HAKA-25 must supply
  the reference price on corporate-action ex-dates.
- Lookback windows **exclude `t`** unless stated otherwise:
  `avgVol_N = mean(V[t−N..t−1])`, `avgVal_N = mean(Val[t−N..t−1])`, `avgFreq_N = mean(F[t−N..t−1])`,
  `HH_N = max(H[t−N..t−1])`, `LL_N = min(L[t−N..t−1])`.
- `RVOL = V[t] / avgVol_20`.
- `CLV` (close location) `= (C − L) / (H − L)`. When `H = L`, `CLV = 1` if `C ≥ prevClose`, otherwise `0`.
  A single-price day locked at a limit therefore reads as "closed at the top".
- `SMA_n` = arithmetic mean of `C` over the last `n` sessions **including `t`**.
- Bollinger `(20, 2)`: middle `= SMA_20`. Upper and lower `= middle ± 2σ`, where `σ` is the **population**
  standard deviation (÷ n) of the same 20 closes. This matches common charting packages. Q-BB4.
- `ATR_14`: Wilder's ATR. True range `= max(H − L, |H − prevClose|, |L − prevClose|)`. The first value is
  the mean of the first 14 TRs. After that, `ATR = (ATR_prev × 13 + TR) / 14`.
- `tick(p)` and `araPrice(ref, board, date)`, `arbPrice(…)`: **only from the HAKA-25 module.** No strategy
  embeds tick sizes or limit percentages.

### 3.2 Determinism

- Same input rows, parameters and rule-set version give the same output. The wall clock only affects the
  freshness label.
- Prices are integer IDR. Ratios are float64. Every threshold is inclusive (`≥`) unless written as `>`. The
  boundary tests in §4–§9 pin this down.
- Candidates are sorted by each strategy's sort key, then by symbol ascending.
- Each candidate records `rulesVersion` (e.g. `breakout@0.1`), so a past result can be explained after the
  parameters change. **Proposed addition to the HAKA-18 contract.** Q-G7.

### 3.3 Common eligibility gate `G` (EOD strategies; the intraday strategies use the same gate on data up to t−1)

| # | Rule | Default | Why |
|---|---|---|---|
| G1 | The latest row date equals `t`, and `V[t] > 0` | — | No trade, suspension, or stale data. Suspension status itself is not available, so "no row for t" is the observable proxy |
| G2 | At least `minHistory` sessions of history, counted from `History.available.from` or the row count | 60 sessions | Indicators need data. It also acts as the **IPO lookback** (ARA HUNTER overrides it, §9) |
| G3 | Traded on at least 18 of the last 20 sessions (`V > 0`) | 18/20 | Excludes thinly traded stocks |
| G4 | `avgVal_20 ≥ minAvgValue` | Rp 1,000,000,000 | Liquidity floor. Q-G2 |
| G5 | `C[t] ≥ minPrice` | Rp 100 | At Rp 50–99 one tick is 1–2% of the price, which distorts every threshold. Q-G3 |
| G6 | OHLC consistent: `L ≤ min(O, C)`, `max(O, C) ≤ H`, `C > 0`, for every row used | — | Bad rows are logged (`strategy_bad_row`) and the symbol is skipped, never guessed |
| G7 | Not on the watchlist board / special notation / full call auction, and not on the acceleration board | — | Different price-formation and limit rules. **No current source has notation; only idx-bei has `board`.** Until a source exists the candidate carries `boardKnown: false`. It is not silently treated as main board. Q-G4 |
| G8 | No corporate-action ex-date inside the lookback window (split, reverse split, rights, bonus) | — | Unadjusted history would create false breakouts and false band breaks. Needs `corporateActions` (idx-bei) or confirmed adjusted history. Q-G5 |

Gate failures are not candidates. A debug view may list them with the failing rule key.

### 3.4 IDX session model (from `src/server/config/idx-calendar.ts`, all `TODO(verify)`)

| Phase | Mon–Thu (WIB) | Friday (WIB) | Use in strategies |
|---|---|---|---|
| Pre-opening (call auction) | 08:45–08:59 | 08:45–08:59 | Sets the opening price. **Auction trades have no aggressor** and are excluded from aggressor shares |
| Session 1 | 09:00–12:00 | 09:00–11:30 | HAKA PAGI window. SCALPING |
| Break | 12:00–13:30 | 11:30–14:00 | No evaluation |
| Session 2 | 13:30–15:49:59 | 14:00–15:49:59 | SCALPING. HAKA SORE (live) |
| Pre-closing (call auction) + post-trading | 15:50–16:15 | 15:50–16:15 | The closing price is set here. Post-trading trades print at the close and appear in done-details with `action` set (fixture: BBCA RG trades at 16:13). **Excluded from aggressor shares** |
| Data final (EOD) | after 16:15 | after 16:15 | EOD engine runs only after `finalAfter` |

Pre-opening and pre-closing times are not yet in `idx-calendar.ts`. They are **assumptions** to verify with
HAKA-25 and the calendar ticket. Shortened sessions (for example the last trading day of the year) and the
moveable holidays for 2026 are not modelled. On a listed holiday no strategy runs.

### 3.5 Output contract (feeds HAKA-18 `ScreenerCandidate`)

```ts
{
  symbol: "ABCD",
  strategyId: "breakout" | "bb-reversal" | "haka-pagi" | "scalping-intraday" | "haka-sore" | "ara-hunter",
  detectedAt: "2026-10-16T09:17:00Z", // engine time the candidate first qualified in this run/stream
  dataAsOf: "2026-10-15",            // EOD: session date t. Live: ISO time of the last trade used
  freshness: "EOD" | "STALE" | "DELAYED" | "LIVE",
  score: null,                       // V1: no score (Q-G6)
  reasons: [{ key: "breakout.closeAboveHigh", params: { lookback: 20, closeIdr: 1080, highIdr: 1040 } }],
  metrics: { closeIdr: 1080, priorHighIdr: 1040, relativeVolume: 3.0 /* units in names, percent = 1.25 means 1.25% */ },
  source: "HAKAPRO_EOD_ENGINE" | "HAKAPRO_REALTIME_ENGINE",
  rulesVersion: "breakout@0.1"        // proposed addition
}
```

- **Freshness.** EOD engine: `EOD` when `t` is the latest completed session (after 16:15 WIB), otherwise
  `STALE`. It is never `DELAYED`. Realtime engine: `LIVE` only when the gateway is LIVE (HAKA-15).
  Otherwise `DELAYED`, with `dataAsOf` = the last trade time. After the window closes, the frozen list is
  `HISTORICAL`.
- **Reasons** are i18n keys (`strategyReason.<strategy>.<key>`) with numeric parameters. HAKAPRO words them in
  en/id, as with `criteria.*` today. No free text from any provider.
- **Wording rules (MIGRATION §9.5) apply to every reason, label and metric name:**
  - Never "buy", "sell", "entry", "target", "signal", "potensi", win rate, drawdown, expected return, or
    up/down arrows.
  - Reasons describe what was observed in data up to `dataAsOf`.
  - `ResearchDisclaimer` is shown wherever candidates appear.
- Forward outcomes (next-day open, follow-through) may be computed **only in offline tests and backtests**.
  They are never stored on a candidate or shown.

---

## 4. BREAKOUT

**Intent:** the session closed above the highest high of the previous N sessions, on clearly higher volume.

**Mode:** EOD (`HAKAPRO_EOD_ENGINE`). An intraday "breaking out now" variant is out of scope for V1.

**Inputs:** `history` daily, ≥ max(`minHistory`, N + 2) rows. Optionally HAKA-25 `araPrice` for a flag.
**Feasibility:** per symbol now. Universe per §2.4.

| Parameter | Default | Unit |
|---|---|---|
| `lookback` N | 20 | sessions |
| `minRelativeVolume` | 2.0 | × avgVol_20 |
| `minCloseLocation` | 0.5 | CLV 0–1 |
| `requireFirstBreak` | true | — |
| `maxBaseRangePercent` (prior range `(HH_N − LL_N) / LL_N × 100`) | disabled (null) | percent (Q-BO2) |

**Qualification** (all must hold, after gate G):

1. `C[t] > HH_N` (strictly above; equal does not qualify).
2. `RVOL ≥ minRelativeVolume`, with RVOL computed over the 20 sessions before `t`.
3. `CLV[t] ≥ minCloseLocation`.
4. If `requireFirstBreak`: `C[t−1] ≤ HH_N` evaluated at `t−1` (= `max(H[t−1−N..t−2])`). Only the first
   close above counts. The next days are not re-listed.
5. If `maxBaseRangePercent` is set: the prior range is at or below it.

**Exclusions:** gate G only. A close at the ARA price is **not** excluded. It sets `atUpperLimit: true`
(needs HAKA-25; without it the field is `null`).

**Sort key:** `breakoutPercent` desc.

**Metrics:**

- `closeIdr`
- `priorHighIdr` (HH_N)
- `lookbackSessions`
- `breakoutPercent` = `(C / HH_N − 1) × 100`
- `relativeVolume`
- `closeLocation`
- `averageValue20Idr`
- `atUpperLimit`

**Why matched (en / id):**

- `closeAboveHigh`: "Closed at Rp {close}, above the highest price of the previous {lookback} sessions
  (Rp {high})." / "Ditutup di Rp {close}, di atas harga tertinggi {lookback} sesi sebelumnya (Rp {high})."
- `relativeVolume`: "Volume was {rvol}× the 20-session average." / "Volume {rvol}× rata-rata 20 sesi."
- `closeLocation`: "Closed in the upper part of the day's range." / "Ditutup di bagian atas rentang harian."
- `firstBreak`: "First close above this level in the window." / "Penutupan pertama di atas level ini dalam
  periode tersebut."

**Test cases** (reduced lookback **N = 5**, RVOL over 5 sessions, `minAvgValue` Rp 1 bn; other gates off).
Shared base rows:

| Date | O | H | L | C | V (shares) |
|---|---|---|---|---|---|
| D-6 | 1000 | 1020 | 990 | 1010 | 1,000,000 |
| D-5 | 1010 | 1030 | 1000 | 1020 | 1,100,000 |
| D-4 | 1020 | 1040 | 1005 | 1015 | 900,000 |
| D-3 | 1015 | 1035 | 1000 | 1025 | 1,000,000 |
| D-2 | 1025 | 1040 | 1015 | 1030 | 1,000,000 |
| D-1 | 1030 | 1035 | 1020 | 1030 | 1,000,000 |

HH_5 over D-5..D-1 = **1040**. avgVol_5 = 1,000,000. avgVal_5 ≈ Rp 1.024 bn.

| Case | D0 (O/H/L/C/V) | Expected | Key metrics |
|---|---|---|---|
| BO+1 | 1035 / 1090 / 1030 / 1080 / 3,000,000 | **match** | breakout +3.85%, RVOL 3.00, CLV 0.833 |
| BO−1 low volume | 1035 / 1090 / 1030 / 1080 / 1,200,000 | no (rule 2) | RVOL 1.20 |
| BO−2 close equals high | 1035 / 1060 / 1030 / **1040** / 3,000,000 | no (rule 1: equality is not above) | breakout 0.00% |
| BO−3 weak close | 1035 / 1100 / 1030 / 1045 / 3,000,000 | no (rule 3) | CLV 0.214 |
| BO−4 not first break | D-1 replaced by 1030/1060/1025/**1055**/2,500,000, D0 = 1055/1090/1050/1080/3,000,000 | no (rule 4) | D-1 already closed above its HH (1040) |
| BO−5 illiquid | all base volumes halved, D0 V 1,500,000 | no (gate G4) | avgVal_5 ≈ Rp 0.512 bn |

**Questions for the owner:**

- Q-BO1: N = 20 (about one month)? Some traders use 52-week (≈ 250) highs, or 55. Should several lookbacks
  be offered as variants?
- Q-BO2: Require a prior consolidation ("base"), e.g. a prior 20-session range ≤ 15%? Default is off.
- Q-BO3: Is RVOL ≥ 2.0 right for IDX second-liners, where volume spikes are common?
- Q-BO4: Should a close at ARA count as a breakout (current default: yes, flagged)?

---

## 5. BB REVERSAL

**Intent (assumption):** the price closed below the lower Bollinger band and has now closed back inside it,
up on the day. This is a mean-reversion setup observed on the long side only. Short selling is restricted
on IDX, so a mirror "upper-band reversal" is not proposed. See Q-BB1.

**Mode:** EOD. **Inputs:** `history` daily, ≥ max(`minHistory`, period + window + 1). **Feasibility:** per
symbol now.

| Parameter | Default | Unit |
|---|---|---|
| `period` | 20 | sessions |
| `stdDevs` k | 2.0 | σ (population) |
| `pierceWindow` W | 3 | sessions before t |
| `pierceBasis` | `close` | `close` or `low` (Q-BB2) |
| `minBandwidthPercent` at the pierce session `(upper − lower) / middle × 100` | 4.0 | percent |
| `requireBullishCandle` | true | — |

**Qualification** (all must hold, after gate G). Bands are computed for each session on its own last
`period` closes.

1. **Pierce:** some session `s ∈ [t−W, t−1]` has `C[s] < lower[s]` (or `L[s] < lower[s]` when
   `pierceBasis = low`).
2. **Meaningful band:** bandwidth at that `s` ≥ `minBandwidthPercent`. This stops a tiny dip in a flat stock
   from qualifying (see BB−4).
3. **Re-entry:** `C[t] > lower[t]`.
4. **Up on the day:** `C[t] > C[t−1]`.
5. If `requireBullishCandle`: `C[t] > O[t]`.

If several sessions in the window pierce, the most recent one is reported.

**Exclusions:** gate G. A close at ARB on `t−1` is not excluded, but `t−1` is reported as `atLowerLimit`
(HAKA-25).

**Sort key:** `percentB` asc. Closest to the lower band first. This is a display order only.

**Metrics:**

- `lowerBandIdr`, `middleBandIdr`, `upperBandIdr`
- `percentB = (C − lower) / (upper − lower)`
- `pierceDate`, `pierceCloseIdr`, `pierceLowerBandIdr`
- `pierceBandwidthPercent`
- `sessionsSincePierce`
- `changePercent`

RSI is **not** a condition. It may be added as an informational metric (Q-BB3).

**Why matched (en / id):**

- `closedBelowBand`: "Closed below the lower Bollinger band (20, 2) on {date}." / "Ditutup di bawah
  Bollinger band bawah (20, 2) pada {date}."
- `backInsideBand`: "Closed back inside the band, above the previous close." / "Kembali ditutup di dalam
  band, di atas penutupan sebelumnya."
- `bullishCandle`: "Closed above its open." / "Ditutup di atas harga pembukaan."

**Test cases** (reduced **period = 10**, k = 2, W = 3, `minBandwidthPercent` 4). Note: with period 5 and
k = 2 a close can never fall below its own band, because the maximum z-score of 5 samples is 1.79. Tests
must use period ≥ 10.

Shared rows D-12..D-2 (O/H/L/C):

| D-12 | D-11 | D-10 | D-9 | D-8 | D-7 | D-6 | D-5 | D-4 | D-3 | D-2 |
|---|---|---|---|---|---|---|---|---|---|---|
| 1000/1005/995/1000 | 1000/1006/996/1002 | 1002/1006/997/1000 | 1000/1004/994/998 | 998/1004/995/1001 | 1001/1005/996/999 | 999/1003/994/997 | 997/1001/992/995 | 995/999/990/994 | 994/996/988/992 | 992/994/986/990 |

Pierce row **D-1 = 988/988/935/940**. Its own lower band is 956.2 and its bandwidth is 6.94%, so D-1
qualifies as the pierce.

| Case | D0 (O/H/L/C) | Expected | Bands at D0 (lower / mid / upper) and %B |
|---|---|---|---|
| BB+1 | 942 / 965 / 940 / 962 | **match** | 949.2 / 986.8 / 1024.4, %B 0.171 |
| BB−1 still below | 940 / 944 / 925 / 930 | no (rule 3) | 934.4 / 983.6 / 1032.8, %B −0.045 |
| BB−2 bearish candle | 970 / 972 / 950 / 955 | no (rule 5) | 946.4 / 986.1 / 1025.8, %B 0.108 |
| BB−4 narrow band | D-1 = 990/992/980/**984** (pierces 985.1), D0 = 984/992/983/990 | no (rule 2: bandwidth 1.99% < 4%) | Without rule 2 this would match. That is why rule 2 exists |
| BB−5 pierce too old | the D-1 drop is moved to D-4, followed by closes 948, 950, 951 and D0 = 951/962/950/960 | no (rule 1: no pierce in D-3..D-1) | — |

**Questions for the owner:**

- Q-BB1: Long side only (lower band)? Or also the "upper-band rejection" mirror, shown as an observation?
- Q-BB2: Pierce by close (default, stricter) or by intraday low (more matches)?
- Q-BB3: Add an oversold condition (e.g. RSI14 ≤ 30 on the pierce day) or a trend filter (e.g. C > SMA200)?
- Q-BB4: Population σ (most charting tools) or sample σ? It changes band values by about 2.5% at n = 20.

---

## 6. HAKA PAGI

**Intent (assumption):** in the first 30 minutes of session 1, the stock is up meaningfully and most traded
value was **buyer-initiated**. "Haka" = *hajar kanan*: buyers lift the offer. "Pagi" = morning. This is an
interpretation and must be confirmed (Q-HP1).

**Mode:** intraday/live (`HAKAPRO_REALTIME_ENGINE`).

**Inputs:**

- Running Trade `trade` messages: time, price, value, action as the aggressor (§2.3).
- `prevClose` and `avgVal_20` from daily history up to `t−1`.
- HAKA-25 for `araPrice`.

**Feasibility:** **blocked** on HAKA-14/15. No EOD equivalent exists, because daily bars do not show who
initiated trades. Historical replay through `doneDetails` is not viable for liquid stocks (§2.1). It is used
only to build small test fixtures.

| Parameter | Default | Unit |
|---|---|---|
| `window` | 09:00:00–09:29:59 WIB (same on Friday) | time |
| `minGainPercent` (last vs prevClose) | 2.0 | percent |
| `minBuyAggressorShare` | 0.65 | share of aggressor-tagged value in the window |
| `minWindowValueRatio` (window value / avgVal_20) | 0.25 | ratio |
| `minWindowValueIdr` | Rp 1,000,000,000 | IDR |
| `requireAboveVwap` | true | — |

**Qualification**, evaluated at every minute boundary from 09:05 to 09:30, after gate G on data up to `t−1`:

1. `last / prevClose − 1 ≥ minGainPercent / 100`.
2. `Σ value(action = BUY) / Σ value(action ∈ {BUY, SELL}) ≥ minBuyAggressorShare`. Only continuous-session,
   regular-board trades in the window count. Pre-opening auction trades are excluded.
3. Window value ≥ `max(minWindowValueRatio × avgVal_20, minWindowValueIdr)`.
4. If `requireAboveVwap`: `last ≥ VWAP_window`.
5. `last < araPrice(prevClose)`. At ARA the offer side is empty, so there is nothing left to "haka". These
   symbols are routed to ARA HUNTER (Q-HP3).

**Lifecycle:**

- A candidate keeps the `detectedAt` of its first qualifying minute.
- It disappears from the live list if it stops qualifying at a later minute. `lastQualifiedAt` is kept.
- At 09:30 the list freezes. It is labelled `HISTORICAL` with `dataAsOf` = 09:29:59 of `t`.
- **No EOD semantics:** after the session it is a record of "matched on t at hh:mm".

**Sort key:** `buyAggressorShare` desc.

**Metrics:**

- `lastPriceIdr`, `prevCloseIdr`, `gainPercent`
- `buyAggressorShare`
- `windowValueIdr`, `windowValueRatio`
- `vwapIdr`
- `firstQualifiedTime`, `lastQualifiedTime`

**Why matched:**

- `morningGain`: "Up {gain}% from the previous close by {time}." / "Naik {gain}% dari penutupan
  sebelumnya pada pukul {time}."
- `buyerInitiated`: "{share}% of traded value since 09:00 was buyer-initiated." / "{share}% nilai transaksi
  sejak 09:00 diinisiasi pembeli."
- `activeMorning`: "Value since 09:00 is {ratio}× of a typical full day's value." / "Nilai sejak 09:00
  setara {ratio}× nilai harian rata-rata."

**Test cases** (5-minute aggregates; prevClose 1000; avgVal_20 Rp 8 bn). Base window HP+1:

| Time | O | H | L | C | Buy-aggr value (Rp m) | Sell-aggr value (Rp m) |
|---|---|---|---|---|---|---|
| 09:00 | 1010 | 1020 | 1005 | 1015 | 400 | 150 |
| 09:05 | 1015 | 1025 | 1010 | 1020 | 350 | 120 |
| 09:10 | 1020 | 1035 | 1020 | 1030 | 300 | 100 |
| 09:15 | 1030 | 1040 | 1025 | 1035 | 250 | 100 |
| 09:20 | 1035 | 1045 | 1030 | 1040 | 200 | 90 |
| 09:25 | 1040 | 1045 | 1035 | 1040 | 150 | 70 |

(The VWAP proxy for tests uses each bar's close weighted by its value.)

| Case | Change vs base | Expected | Key metrics |
|---|---|---|---|
| HP+1 | — | **match** at 09:30 | gain 4.00%, buy share 0.724, value Rp 2.28 bn = 0.285×, VWAP 1027.3 |
| HP−1 seller-led | buy values × 0.6, sell values × 2.2 | no (rule 2) | buy share 0.417 |
| HP−2 faded | last bar 1040/1040/1010/1015 | no (rule 1) | gain 1.50% |
| HP−3 thin | avgVal_20 = Rp 12 bn | no (rule 3) | ratio 0.19 |
| HP−4 at ARA | prevClose 400, last 500 = araPrice under test rule set T1 (§9) | no (rule 5) → appears in ARA HUNTER | — |
| HP−5 auction excluded | add a pre-opening print 08:59 of Rp 3 bn tagged SELL | still **match** (auction value ignored) | buy share unchanged |

**Questions for the owner:**

- Q-HP1: Is HAKA PAGI "aggressive buying in the opening minutes", as assumed? Or is it a **gap-up at the
  open** (opening price vs previous close), or an **EOD list of candidates for the next morning**?
- Q-HP2: Is the window 09:00–09:30 right? Should it include the pre-opening auction (IEP/opening price vs
  previous close) as its own condition?
- Q-HP3: Exclude stocks at ARA (default) or include them, flagged?
- Q-HP4: Thresholds: gain ≥ 2%, buyer share ≥ 65%, value ≥ 25% of a normal day. Are these realistic for
  your users' universe?

---

## 7. SCALPING INTRADAY

**Intent (assumption):** stocks that are currently liquid, actively traded and moving enough intraday for
very short holding periods, with ticks that are small relative to the price. This is a **filter**, not a
directional pattern. Q-SC1.

**Mode:** intraday/live, plus a proposed **EOD pre-filter** ("scalping watchlist" for the next session). The
pre-filter is feasible now per symbol, once HAKA-25 exists.

### 7a. EOD pre-filter (`HAKAPRO_EOD_ENGINE`, strategyId `scalping-intraday`, `variant: "eod-watchlist"`)

| Parameter | Default | Unit |
|---|---|---|
| `minAtrPercent` (`ATR_14 / C × 100`) | 3.0 | percent |
| `minAvgValue20Idr` | Rp 10,000,000,000 | IDR |
| `minAvgFrequency20` | 2,000 | trades/session |
| `maxRelativeTickPercent` (`tick(C) / C × 100`) | 0.5 | percent |

Qualification: gate G, plus all four thresholds.

Under the test rule set T1 (§9), the relative tick at 0.5% passes from Rp 1,000 (tick 5) and fails at Rp 150
and Rp 300 (0.667%). It is 0.5% again at Rp 2,000, where the tick becomes 10. **The tick table must come from
HAKA-25.**

### 7b. Live (`HAKAPRO_REALTIME_ENGINE`)

Evaluation windows avoid the open, the lunch break and the close:

- Mon–Thu: 09:15–11:45 and 13:45–15:30.
- Friday: 09:15–11:15 and 14:15–15:30.

The list is evaluated every minute.

1. Rolling 15-minute value ≥ Rp 1,000,000,000 **and** rolling 15-minute trade count ≥ 150.
2. Intraday range so far `(H_today − L_today) / L_today ≥ 2%`.
3. Pace: cumulative value today ≥ `avgVal_20 × elapsedSessionFraction`. Elapsed fraction = continuous-session
   minutes elapsed ÷ total continuous minutes for that weekday.
4. `tick(last) / last ≤ 0.5%`.
5. `arbPrice + 2 ticks ≤ last ≤ araPrice − 2 ticks`. The stock must be able to trade both ways.

Outside the windows, the last list is shown frozen (`HISTORICAL`).

**Metrics:**

- `atrPercent`
- `averageValue20Idr`, `averageFrequency20`
- `relativeTickPercent`
- live only: `rollingValue15mIdr`, `rollingTrades15m`, `intradayRangePercent`, `paceRatio`

**Why matched:**

- `liquid`: "Average daily value Rp {value} and {freq} trades per session." / "Rata-rata nilai harian
  Rp {value} dan {freq} transaksi per sesi."
- `volatile`: "Average true range is {atr}% of the price." / "Average true range {atr}% dari harga."
- `fineTick`: "One price tick is {tick}% of the price." / "Satu fraksi harga = {tick}% dari harga."
- `activeNow` (live): "Rp {value} traded in the last 15 minutes." / "Rp {value} ditransaksikan dalam
  15 menit terakhir."

**Test cases** (EOD pre-filter; reduced **ATR period 3**; tick rule set T1). The full-period test uses the
same TR arithmetic.

| Case | Rows (O/H/L/C), D-3 → D0 | avgVal / avgFreq | Expected | Key metrics |
|---|---|---|---|---|
| SC+1 | 1000/1040/980/1020, 1020/1060/1000/1010, 1010/1050/990/1040, 1040/1080/1010/1030 | Rp 25 bn / 4,000 | **match** | TRs 60, 60, 70 → ATR 63.3 = 6.15%; tick 5/1030 = 0.485% |
| SC−1 quiet | 1000/1010/995/1005, 1005/1012/1000/1010, 1010/1015/1005/1010, 1010/1018/1004/1015 | Rp 25 bn / 4,000 | no (ATR 1.18%) | — |
| SC−2 coarse tick | SC+1 shape scaled to close 150 | Rp 25 bn / 4,000 | no (tick 0.667%) | — |
| SC−3 thin | SC+1 rows | Rp 4 bn / 900 | no (value, frequency) | — |
| SC−4 boundary | SC+1 with D0 = 1040/1080/995/**1000** | Rp 25 bn / 4,000 | **match** (inclusive ≤) | tick 5/1000 = 0.500%; TRs 60, 60, 85 → ATR 6.83% |

**Questions for the owner:**

- Q-SC1: Is "SCALPING INTRADAY" meant to be a **liquidity/volatility list** (as proposed) or a **pattern**,
  e.g. VWAP reclaim or opening-range break?
- Q-SC2: Is the EOD "scalping watchlist" useful for V1 while the live version waits for Phase 2?
- Q-SC3: Thresholds (ATR ≥ 3%, value ≥ Rp 10 bn, frequency ≥ 2,000, tick ≤ 0.5%)?

---

## 8. HAKA SORE / BSJP

**Intent (assumption):** the stock closed strong. It was up on the day, closed near the high, and had
elevated volume. This is the pattern traders screen late in the day for an overnight hold. "BSJP" =
*beli sore jual pagi* ("buy in the afternoon, sell in the morning"). "Haka sore" = aggressive buying late in
the session. Q-HS1.

**Naming issue (§9.5).** "Beli sore jual pagi" is literally a buy/sell instruction. Proposal: the display name
is **"HAKA SORE"**. "BSJP" appears only as an alias in search. The description reads "Strong close: up on the
day, closing near the high on elevated volume." Q-HS2.

**Mode:** two variants.

- **8a. EOD (`HAKAPRO_EOD_ENGINE`), feasible per symbol after HAKA-25.**
  - This is a historical record of the session's close.
  - It is **not actionable at the close**: the list exists only after 16:15, when the session is over.
  - The UI must say "closed strong on {t}", never "for tomorrow".
- **8b. Live (`HAKAPRO_REALTIME_ENGINE`), blocked on HAKA-14/15.** Evaluated 15:00–15:49, before the
  pre-closing auction.

| Parameter | Default | Unit |
|---|---|---|
| `minChangePercent` (C vs prevClose) | 2.0 | percent |
| `minCloseLocation` | 0.8 | CLV |
| `minRelativeVolume` | 1.5 | × avgVol_20 |
| `trendFilter` | `C > SMA_20` | — |
| live: `window` | 14:50–15:49:59 (last 60 continuous minutes; same end time on Friday) | time |
| live: `minBuyAggressorShareWindow` | 0.60 | share |

**Qualification, EOD (8a)**, after gate G:

1. `C[t] / prevClose − 1 ≥ 2%`.
2. `CLV[t] ≥ 0.8`.
3. `RVOL ≥ 1.5`.
4. `C[t] > SMA_20[t]`.
5. `C[t] < araPrice(prevClose)`. A close at ARA belongs to ARA HUNTER (Q-HS3).

**Qualification, live (8b):** rules 1, 3 (as pace: cumulative value ≥ `avgVal_20 × elapsedFraction × 1.5`),
4 and 5, applied to `last`. In addition:

- `last ≥ VWAP_day`.
- Last is in the top 20% of the day's range so far.
- Buyer-initiated share of value in the window ≥ 0.60.

The list freezes at 15:50. The EOD run then adds `closeVsFrozenPercent`, the pre-closing auction result, as
an observed metric only.

**Sort key:** `closeLocation` desc, then `relativeVolume` desc.

**Metrics:**

- `changePercent`, `closeLocation`, `relativeVolume`
- `sma20Idr`
- `closeIdr`, `highIdr`
- live: `buyAggressorShareWindow`, `vwapIdr`

**Never:** next-morning open, gap, or "jual pagi" outcome. Those exist only in offline backtests (§3.5).

**Why matched:**

- `upOnDay`: "Closed up {change}% from the previous close." / "Ditutup naik {change}% dari penutupan
  sebelumnya."
- `closedNearHigh`: "Closed near the day's high (top {pct}% of the range)." / "Ditutup dekat harga tertinggi
  hari itu."
- `relativeVolume` (as in BREAKOUT).
- `aboveSma20`: "Closed above its 20-session average." / "Ditutup di atas rata-rata 20 sesi."

**Test cases** (EOD; reduced **N = 5** for RVOL and SMA; araPrice from T1 → prevClose 500 gives ARA 625).

Base rows (O/H/L/C/V):

- D-5 480/490/478/486/2.0m
- D-4 486/494/484/490/2.0m
- D-3 490/496/486/488/2.0m
- D-2 488/498/486/496/2.0m
- D-1 496/502/492/500/2.0m

| Case | D0 (O/H/L/C/V) | Expected | Key metrics |
|---|---|---|---|
| SJ+1 | 500 / 530 / 498 / 528 / 4.0m | **match** | change 5.60%, CLV 0.938, RVOL 2.00, SMA_5 500.4 |
| SJ−1 faded | 500 / 540 / 500 / 520 / 4.0m | no (rule 2) | CLV 0.50 |
| SJ−2 at ARA | 510 / 625 / 505 / 625 / 4.0m | no (rule 5) → ARA HUNTER | change 25.0% |
| SJ−3 low volume | 500 / 530 / 498 / 528 / 2.2m | no (rule 3) | RVOL 1.10 |
| SJ−4 boundary | 502 / 512 / 502 / 510 / 3.0m | **match** (every threshold hit exactly; inclusive) | change 2.00%, CLV 0.800, RVOL 1.50, SMA_5 496.8 |

**Questions for the owner:**

- Q-HS1: Is HAKA SORE the same thing as BSJP (one strategy, as assumed) or two? If two: HAKA SORE =
  aggressive buying in session 2 (live), BSJP = strong-close EOD list?
- Q-HS2: Display name without "beli/jual" (proposed "HAKA SORE"; BSJP only as a search alias)?
- Q-HS3: Exclude closes at ARA (default) or include them?
- Q-HS4: Is the EOD variant worth shipping, given it only appears after the close?

---

## 9. ARA HUNTER

**Intent:** stocks that **closed at the upper auto-rejection limit (ARA)** for the session. Optional
secondary states are "touched ARA intraday but closed below", and consecutive-limit streaks. "Hunter" (the
screening use) is interpreted. Q-AH1.

**Mode:** EOD now (after HAKA-25). Live later: "at or within 1 tick of ARA now", HAKA-14/15.

**Inputs:**

- `history` daily: `prevClose`, OHLC, V.
- **HAKA-25:** `araPrice(reference, board, date)`, `tick(p)`, reference-price rules, board rules,
  IPO-day rules. **No approximation is allowed** (HAKA-25 says so explicitly).
- Optional universe pre-filter: `marketCap` closes for `t` and `t−1` (§2.4, Q-G1).

**Not available:** the bid queue at ARA ("antrian"), order-book depth, and the unfilled demand. A
"locked at ARA" state is inferred only from `O = H = L = C = araPrice`.

### Test rule set T1 (illustrative, for tests only; real values come from HAKA-25)

These values are **not** a claim about current IDX rules. IDX has changed the ARB rules several times since
2020, and the acceleration board and full call auction differ. They exist so that the tests are concrete.

- Tick: < 200 → 1; 200–< 500 → 2; 500–< 2,000 → 5; 2,000–< 5,000 → 10; ≥ 5,000 → 25.
- ARA %: reference 50–200 → 35%; > 200–5,000 → 25%; > 5,000 → 20%.
- `araPrice = floor((ref × (1 + pct)) / tick(raw)) × tick(raw)`, rounded down to a valid tick.

**Qualification, EOD**, after gate G with these overrides:

- G2 (`minHistory`) is replaced by `minHistory = 1` session plus a valid reference price. IPO stocks are
  allowed from listing day + 1. The listing day itself is excluded until HAKA-25 defines the IPO-day limit.
- G4 (liquidity) is replaced by `Val[t] ≥ Rp 500,000,000`. ARA stocks are often illiquid before the move.
- G7 (board) is **mandatory**. If the board is unknown, the candidate is shown with `boardKnown: false`, and
  the limit is computed with main/development board rules **only if HAKA-25 confirms they apply**. Otherwise
  the symbol is skipped. Q-G4.
- G8: on an ex-date, the reference price is HAKA-25's adjusted reference, not `C[t−1]`.

State classification:

1. `AT_LIMIT` (**qualifies**): `C[t] = araPrice(ref)`.
   - Sub-flag `lockedAllDay`: `O = H = L = C`.
2. `TOUCHED_LIMIT` (**secondary; default: does not qualify**, Q-AH2): `H[t] = araPrice(ref)` and
   `C[t] < araPrice(ref)`.
3. Everything else does not qualify. That includes "within k ticks of ARA" (Q-AH3).

`consecutiveLimitSessions` = the number of consecutive sessions ending at `t` in state `AT_LIMIT`, each using
its own reference.

**Sort key:** `consecutiveLimitSessions` desc, then `valueIdr` desc.

**Metrics:**

- `closeIdr`, `referencePriceIdr`, `araPriceIdr`
- `limitPercent` (from HAKA-25)
- `state`, `lockedAllDay`, `consecutiveLimitSessions`
- `valueIdr`, `relativeVolume`
- `sessionsSinceListing`
- `boardKnown`
- `ruleSetVersion` (HAKA-25 version)

**Why matched:**

- `closedAtUpperLimit`: "Closed at the upper price limit (Rp {ara}, +{pct}% from the reference price)." /
  "Ditutup di batas atas auto-rejection (Rp {ara}, +{pct}% dari harga acuan)."
- `lockedAllDay`: "Traded only at the limit price all session." / "Hanya diperdagangkan di harga batas
  sepanjang sesi."
- `streak`: "{n} consecutive sessions closed at the upper limit." / "{n} sesi berturut-turut ditutup di batas
  atas."
- `touchedLimit` (if enabled): "Reached the upper limit intraday and closed at Rp {close}." / "Sempat
  menyentuh batas atas dan ditutup di Rp {close}."

**Test cases** (rule set T1):

| Case | Reference (C[t−1]) | D0 (O/H/L/C) | araPrice | Expected |
|---|---|---|---|---|
| AH+1 | 400 | 420 / 500 / 418 / 500 | 500 | **AT_LIMIT** |
| AH+2 locked | 400 | 500 / 500 / 500 / 500 | 500 | **AT_LIMIT**, `lockedAllDay` |
| AH+3 tick rounding | 1235 | 1300 / 1540 / 1290 / 1540 | 1540 (raw 1543.75) | **AT_LIMIT**. An engine comparing to the raw 1543.75 would wrongly miss it |
| AH+4 low band | 190 | 200 / 256 / 198 / 256 | 256 (raw 256.5, 35%) | **AT_LIMIT** |
| AH+5 streak | C[D-2] = 320; D-1 closes 400, D0 closes 500 | each closes at its own limit | 400 (D-1), 500 (D0) | **AT_LIMIT**, `consecutiveLimitSessions = 2` |
| AH−1 touched | 400 | 420 / 500 / 418 / 470 | 500 | `TOUCHED_LIMIT`, not a match under the default |
| AH−2 near | 400 | 420 / 496 / 418 / 496 | 500 | no (2 ticks below) |
| AH−3 listing day | — (IPO) | any | undefined until HAKA-25 | excluded |
| AH−4 no trade | 400 | no row for D0 / V = 0 | — | excluded (G1) |
| AH−5 band edge | 4000 | … / 5000 / … / 5000 | 5000 (25%, tick 25 valid) | **AT_LIMIT**. Guards the band and tick lookup at the boundary |

**Questions for the owner:**

- Q-AH1: Is "ARA HUNTER" meant to list **stocks that hit ARA** (record, EOD), **stocks approaching ARA now**
  (live), or **stocks likely to hit ARA**? The last one is a prediction and conflicts with §9.5. Proposed:
  only the first two.
- Q-AH2: Should `TOUCHED_LIMIT` (hit ARA, then fell back) be shown as its own section?
- Q-AH3: Include "near ARA" (e.g. within 2 ticks or ≥ 80% of the limit move)?
- Q-AH4: IPO stocks: show from listing day + 1 (default)? Or treat IPO ARA streaks as their own list?

---

## 10. Cross-cutting questions for the owner (Q-G)

- **Q-G1, universe.** For V1, run the EOD strategies only on a bounded user list (watchlist, ≤ 50 symbols, on
  demand)? Or wait for a Data Engine with a universe-wide EOD source? Options and constraints are in §2.4.
  Also: is the `marketCap` sweep of about 40 calls per session acceptable as an ARA pre-filter?
- **Q-G2, liquidity floor:** average 20-session value ≥ Rp 1 bn, traded on 18 of 20 sessions?
- **Q-G3, minimum price:** Rp 100 (excludes Rp 50–99 stocks)?
- **Q-G4, board/notation:** no current source has special notation or the watchlist board. Should HAKAPRO
  show `boardKnown: false`, skip the stock, or wait for a source?
- **Q-G5, corporate actions:** is arjum `history` adjusted for splits and rights? This must be verified on
  one known split with an existing recording, not a new probe. Until confirmed, a symbol with a known
  ex-date in the lookback is excluded. But the ex-date source (idx-bei) is not configured either.
- **Q-G6, score:** keep `score: null` in V1, with no composite ranking that could read as quality or
  probability? Or define one? Proposal: null. Each strategy has a transparent sort key instead.
- **Q-G7, contract:** add `rulesVersion` and `variant` to the HAKA-18 `ScreenerCandidate`?
- **Q-G8, history examples:** the ticket asks for *historical* positive and negative examples. This draft
  uses synthetic tables only, to comply with provider conduct. Should the owner nominate real
  (symbol, date) pairs per strategy, checked against already-recorded fixtures or a single paced lookup each?

## 11. What happens after approval

1. The owner answers the questions and corrects the defaults. The status changes to `APPROVED v1.0`, and
   every section gets a `rulesVersion`.
2. HAKA-25 (tick/ARA module) lands first. ARA HUNTER, HAKA SORE rule 5 and SCALPING depend on it.
3. HAKA-18 contract, then the pure, unit-tested strategy functions (`src/server/strategies/*`). The test
   tables above become the first fixtures. The test suite must include the boundary and rounding cases.
4. The live variants wait for HAKA-14/15.
