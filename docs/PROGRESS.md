# HAKAPRO — Progress

| # | Checkpoint | Status | Commit |
| --- | --- | --- | --- |
| 1 | Inventory (`docs/MIGRATION.md`) | ✅ approved 2026-10-03 with corrections (MIGRATION §9) | — |
| 2 | Scaffold: typecheck / lint / build pass | ✅ awaiting approval | see git log |
| 3 | Data layer ported, fixture-backed `MarketDataSource`, unit tests | ⏳ | |
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
