/** Single source of query keys. Symbols are upper-cased so equivalent requests share a cache entry. */
export const queryKeys = {
  search: (q: string) => ["market", "search", q.trim().toUpperCase()] as const,
  savedScreens: (userId: string) => ["user", "saved-screens", userId] as const,
};
