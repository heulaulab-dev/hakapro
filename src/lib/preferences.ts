export const THEMES = ["dark", "light"] as const;
export const DENSITIES = ["comfortable", "compact"] as const;
export type Theme = (typeof THEMES)[number];
export type Density = (typeof DENSITIES)[number];

export const THEME_COOKIE = "hakapro-theme";
export const DENSITY_COOKIE = "hakapro-density";

/** Dark-first: anything unrecognised falls back to dark / comfortable. */
export function parseTheme(value: string | undefined): Theme {
  return value === "light" ? "light" : "dark";
}

export function parseDensity(value: string | undefined): Density {
  return value === "compact" ? "compact" : "comfortable";
}
