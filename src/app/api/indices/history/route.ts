import { marketRoute } from "@/server/http";

// IHSG + IDX-IC sector-index daily closes (`/v1/indices/history`), for the sector-rotation RRG.
// Engine-only; arjum/fixture lanes answer UNSUPPORTED and the workspace shows its unavailable state.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? undefined;
  const to = url.searchParams.get("to") ?? undefined;
  const codes = url.searchParams.get("codes")?.split(",").map((code) => code.trim()).filter(Boolean);
  return marketRoute(request, { endpoint: "indices-history", cacheControl: "private, max-age=300" }, (source) => source.indicesHistory({ from, to, codes }, request.signal));
}
