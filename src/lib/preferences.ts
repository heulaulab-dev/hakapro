export const THEMES = ["dark", "light"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export type Theme = (typeof THEMES)[number];
export type Density = (typeof DENSITIES)[number];

export const THEME_COOKIE = "hakapro-theme";
export const DENSITY_COOKIE = "hakapro-density";

/** Browser UI color (`<meta name="theme-color">`) per theme: brand Night / Paper (docs/brand/tokens.json). */
export const THEME_COLOR: Record<Theme, string> = { dark: "#081720", light: "#F3F7F7" };

/** Dark-first: anything unrecognised falls back to dark / comfortable. */
export function parseTheme(value: string | undefined): Theme {
  return value === "light" ? "light" : "dark";
}

export function parseDensity(value: string | undefined): Density {
  return value === "compact" ? "compact" : "comfortable";
}
