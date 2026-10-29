# Stock-to-Sector Rotation Map

Date: 2026-10-30

## Intent

Extend the existing market/sector rotation analysis to show which liquid IDX issuers are gaining or losing relative strength against their current sector peers. This is a separate Discover module, using a transparent four-quadrant RRG-style calculation over data already persisted by the Engine.

## Goals

- Add a protected, top-level module at `/discover/stock-rotation` with sector and daily/weekly controls.
- Show up to 50 liquid issuers in a four-quadrant RS-Ratio/RS-Momentum graph and a sortable ranking.
- Build a synthetic equal-weight sector basket from stored split-adjusted stock closes, excluding the issuer itself from its own benchmark (leave-one-out).
- Report active sector membership, ranked cohort size, paired observations, minimum peer count, basket session coverage, and latest data date.
- Preserve gaps; never fill missing closes. Display the current security-master sector mapping and disclose that it is applied historically.
- Keep response size and database reads bounded; no new scraper, table, dependency, or database.
- Localize the module in English and Indonesian, reuse the existing RRG chart and accessible UI components.
- Keep existing authenticated Engine BFF access and no-store/private semantics.

## Method

- Read up to 2,500 active securities, then select the requested normalized sector.
- The initial `all` request selects the largest currently classified sector (name ascending for ties) and returns the available sector list so the view can present a real default selection.
- Use the latest 252 stored market sessions plus 40 warm-up sessions and a base session. Compute trailing 20-session mean traded value; require at least 15 value observations and select the top 50 deterministically (mean value descending, symbol ascending).
- For each date, calculate a peer return only when that date and the previous accepted basket date both have positive, stored closes. If coverage is insufficient, leave a gap; the next accepted observation measures the peer return across the interval from the prior accepted date. No forward fill or interpolation.
- For each displayed issuer, average returns across its sector peers, excluding itself. Require at least `min(5, max(2, ceil(peer count × 20%))` paired peers on that date. Compound accepted basket returns from 100; dates below minimum coverage remain gaps.
- Run the existing documented HakaPro RRG approximation only on the latest uninterrupted segment of exact issuer and synthetic-basket dates; do not compress missing periods into one RRG step. Apply existing daily/weekly parameters and minimum-observation logic. Return at most 12 points per issuer, with a UI control to show the last 4, 8, or 12.
- Disclose that the synthetic basket is not an IDX index, current classifications are applied to past prices, results exclude dividend income, and gaps are not filled. This is descriptive research, not a recommendation or trading signal.

## Non-goals

- Claiming official index status or proprietary JdK RRG methodology.
- A backtest, forecast, buy/sell signal, or total-return series.
- Collecting more market data or adding a third-party source.
- Showing illiquid issuers that fail the value-observation minimum.

## Acceptance

- Engine tests prove leave-one-out peer returns, minimum peer coverage, missing-session gaps reset the RRG observation run, deterministic liquid ranking, selected sector normalization, and insufficient history.
- HTTP validation and authenticated BFF route are covered.
- App API schemas validate the Engine response; localized UI shows chart, ranking, sector universe, freshness and methodology.
- The page appears as a standalone desktop sidebar item and in mobile's module list, not nested under Ownership.
- Focused tests, typecheck, lint and production build pass; feature is promoted through develop and staging to main, then production health and the protected route are verified.
