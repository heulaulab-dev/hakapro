import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const css = readFileSync("src/app/globals.css", "utf8");
const tokens = JSON.parse(readFileSync("docs/brand/tokens.json", "utf8")) as { colors: Record<string, string> };

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
}

describe("brand tokens", () => {
  test("globals.css mirrors docs/brand/tokens.json", () => {
    for (const [name, hex] of Object.entries(tokens.colors)) {
      const value = new RegExp(`--brand-${name.replace("_", "-")}:\\s*(#[0-9a-f]{6});`, "i").exec(css)?.[1];
      expect(value?.toLowerCase(), name).toBe(hex.toLowerCase());
    }
  });

  // Brand teal is identity, never a bullish signal: market, chart and data code must not use brand colors.
  test("no brand color in price, change or flow indicators", () => {
    const market = ["src/components/market", "src/components/charts", "src/components/data", "src/components/kit", "src/lib/charts"].flatMap(files);
    const brandHexes = Object.values(tokens.colors).map((hex) => hex.toLowerCase());
    for (const file of market) {
      const source = readFileSync(file, "utf8").toLowerCase();
      expect(source, file).not.toMatch(/brand-/);
      for (const hex of brandHexes) expect(source, `${file} uses ${hex}`).not.toContain(hex);
    }
  });
});
