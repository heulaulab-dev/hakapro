# Plan: Stock-to-Sector Rotation Map

Spec: `docs/superpowers/specs/2026-10-30-stock-sector-rotation-design.md`

## Task 1 — Engine calculation and route

- Add an Engine serve function using existing `MarketStore`, persisted daily prices, current sector master and `computeRotation`.
- Add response schemas and a bounded `/v1/sector-rotation/stocks` GET route.
- Write unit and HTTP tests first for ranking, peer exclusion, gaps, peer minimum, sector/interval validation and empty history.
- Expected: focused Engine tests pass, payload capped at 50 issuers × 12 RRG points, no DB schema migration.

## Task 2 — Authenticated app BFF and typed API

- Add shared source query/result contract, Engine source method, app API route, zod client schema and query hook.
- Write route/schema tests first; follow the existing marketRoute authentication and private cache conventions.
- Expected: route returns validated envelope and unauthenticated requests follow existing auth behavior.

## Task 3 — Standalone UI module

- Add protected page, top-level nav leaf, translations, RRG chart and accessible ranking/methodology coverage.
- Write/update component and navigation tests first. Reuse existing RrgChart, data state, chart conventions and UI primitives.
- Expected: English/Indonesian page presents exact data date, basket session coverage, adjustable RRG tail length, and synthetic/current-membership caveats; absent data state is explicit.

## Task 4 — Verification and shipping

- Run focused tests, Engine and app typechecks, lint on changed files, full unit suite and production build.
- Review diff, commit, PR into develop, promote via staging, verify each deployment and production protected page/health.
- Expected: all checks green and production contains the standalone module.
