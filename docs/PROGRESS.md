# HAKAPRO — Progress

| # | Checkpoint | Status | Commit |
| --- | --- | --- | --- |
| 1 | Inventory (`docs/MIGRATION.md`) | ✅ approved 2026-10-03 with corrections (MIGRATION §9) | — |
| 2 | Scaffold: typecheck / lint / build pass | ✅ approved 2026-10-03 | a46b4fc |
| 3 | Data layer ported, fixture-backed `MarketDataSource`, unit tests | ✅ awaiting approval | see git log |
| 4 | Foundations: i18n, format module, tokens, FreshnessBadge | ⏳ | |
| 5 | App shell | ⏳ | |
| 6 | Primitives | ⏳ | |
| 7 | Vertical slice: Home → Strategies → Why matched → Stock Overview | ⏳ | |

## Checkpoint 2 notes
- Scaffold: create-next-app 16.3.8 (TS, App Router, Tailwind v4, ESLint, `src/`, `@/*`, Turbopack), shadcn 4.21.1 `radix-nova` preset, Radix base.
- TypeScript stays on 5.9.3 (create-next-app default; TS 7 exists but is not the default).
- `@tanstack/react-table` pinned to `^8` (8.21.3) per decision §9.7.
- Recharts 3.8.0 came in via `shadcn add chart`, cmdk 1.1.1 via `shadcn add command`.
- Fonts come from the `geist` package (`--font-geist-sans` / `--font-geist-mono`). Fixed shadcn's self-referencing `--font-sans`.
- Bun blocked postinstall scripts for `@parcel/watcher` and `@swc/core` (transitive). The build doesn't need them. Left untrusted.
- Vitest runs in a Node environment, with `server-only` aliased to a stub for unit tests. Playwright projects are desktop + mobile on port 3200.

## Checkpoint 3 notes
- `MarketDataSource` interface (`src/server/market/source.ts`). Implementations: `ArjumSource`, `IdxBeiSource`, `FixtureSource`. Selected by `MARKET_DATA_SOURCE`; `arjum` mode also uses idx-bei for capabilities arjum lacks, but only when `MARKET_API_URL` is set.
- **Production guard:** `next.config.ts` calls `resolveMarketDataSource`. `next build` and `next start` exit 1 when the source is missing or set to `fixture`, for both `NODE_ENV=production` and `VERCEL_ENV=production`. As a result, a local `bun run build` needs `MARKET_DATA_SOURCE=arjum` (no credentials are needed to compile). `typecheck` passes that value to `next typegen` only, because typegen loads config in the production-build phase.
- **Fixture mode:** the FIXTURE DATA banner renders in the root layout (it moves into the app shell in Step 5). Fixture freshness is capped at HISTORICAL/UNAVAILABLE (`clampFixtureFreshness`). Unit and Playwright tests cover both.
- **Server-only boundary:** `bun run check:server-boundary` checks that the Vitest stub is only aliased in `vitest.config.mts`, that the real package throws outside react-server, and that `next build` fails when a client component imports `src/server/log.ts`.
- `asOf` is `string | null`: null only alongside UNAVAILABLE (enforced by `withFreshness`).
- **Units:** all domain percent fields use percent units. arjum `change_pct` is already a percent; idx-bei fractions are multiplied by 100.
