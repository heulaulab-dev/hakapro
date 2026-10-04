# HAKA PRO brand sources

- `tokens.json`: source of truth for brand colors. `src/app/globals.css` mirrors them as `--brand-*`.
- `hakapro-logo-guidelines.html`: usage rules (clear space, minimum sizes, misuse).
- `_generator.py`: script that produced the asset pack.

Runtime assets are served from `public/brand/` (`svg/`, `png/`, `favicon/`). Use them through
`src/components/brand/logo.tsx`, not by inlining SVG markup: every file uses `id="g"` for its gradient,
so inlined copies collide.
