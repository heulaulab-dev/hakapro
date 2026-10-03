export type QueryValue = string | number | boolean | readonly string[] | null | undefined;

export function buildProviderUrl(baseUrl: string, path: string, query: Record<string, QueryValue> = {}): string {
  const cleanPath = path.split("/").map((part) => encodeURIComponent(decodeURIComponent(part))).join("/");
  const url = new URL(cleanPath.replace(/^\//, ""), `${baseUrl.replace(/\/$/, "")}/`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return url.toString();
}
