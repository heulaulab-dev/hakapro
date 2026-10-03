/** Single source of query keys. Symbols are upper-cased so equivalent requests share a cache entry. */
export const queryKeys = {
  search: (q: string) => ["market", "search", q.trim().toUpperCase()] as const,
  history: (symbol: string, frame = "daily", limit = 0) => ["market", "history", symbol.toUpperCase(), frame, limit] as const,
  brokerSummary: (symbol: string) => ["market", "broker-summary", symbol.toUpperCase()] as const,
  strategies: () => ["market", "strategies"] as const,
  insiders: (symbol: string) => ["market", "insiders", symbol.toUpperCase()] as const,
  marketCap: () => ["market", "market-cap"] as const,
  stockOverview: (symbol: string) => ["market", "overview", symbol.toUpperCase()] as const,
  marketOverview: () => ["market", "market-overview"] as const,
  news: (perPage = 8) => ["market", "news", perPage] as const,
  announcements: (keywords: string) => ["market", "announcements", keywords] as const,
  watchlist: (userId: string) => ["user", "watchlist", userId] as const,
  quotes: (symbols: string[]) => ["market", "quotes", [...symbols].sort().join(",")] as const,
  brokerAccumulation: (symbol: string, startDate = "", top = 0) => ["market", "broker-accumulation", symbol.toUpperCase(), startDate, top] as const,
  financials: (symbol: string, reportType: string, period: string) => ["market", "financials", symbol.toUpperCase(), reportType, period] as const,
  screen: (conditions: unknown) => ["market", "screen", JSON.stringify(conditions)] as const,
  savedScreens: (userId: string) => ["user", "saved-screens", userId] as const,
};
