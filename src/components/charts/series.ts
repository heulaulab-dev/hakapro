/** Fixed categorical order (see globals.css). Color follows the entity's slot, never its rank after filtering. */
export const SERIES_TOKENS = ["--series-1", "--series-2", "--series-3", "--series-4", "--series-5", "--series-6"] as const;
export const MAX_SERIES = SERIES_TOKENS.length;
export const seriesColor = (index: number) => `var(${SERIES_TOKENS[index % MAX_SERIES]})`;
