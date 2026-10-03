import { z } from "zod";
import { fetchEnvelope } from "./envelope";

export const searchResultSchema = z.object({ symbol: z.string(), companyName: z.string(), lastDate: z.string() });
export type SearchResult = z.infer<typeof searchResultSchema>;

export function searchStocks(q: string, signal?: AbortSignal) {
  return fetchEnvelope(`/api/search?q=${encodeURIComponent(q)}`, z.array(searchResultSchema), { signal });
}
