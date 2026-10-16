// Writes the committed SYNTHETIC ownership fixtures (fake tickers and holders; see ../../ownership-fixtures.ts).
// Run from the repo root: `bun services/engine/test/fixtures/ownership/generate.ts`. A unit test checks the committed
// files still match this output.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { FEB_2026, MAR_2026, syntheticOwnershipCsv, syntheticOwnershipPdf } from "../../ownership-fixtures";

export const OWNERSHIP_FIXTURES = {
  "synthetic-1pct-2026-02.pdf": () => syntheticOwnershipPdf(FEB_2026),
  "synthetic-1pct-2026-03.pdf": () => syntheticOwnershipPdf(MAR_2026, { twoLineHeader: true, headerOnEveryPage: false }),
  "synthetic-1pct-2026-03.csv": () => new TextEncoder().encode(syntheticOwnershipCsv(MAR_2026)),
} as const;

if (import.meta.main) {
  for (const [name, build] of Object.entries(OWNERSHIP_FIXTURES)) {
    writeFileSync(fileURLToPath(new URL(name, import.meta.url)), build());
    console.log(`wrote ${name}`);
  }
}
