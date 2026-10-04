/**
 * Post-auth destination. Only same-origin, locale-prefixed app paths are accepted; anything else
 * (absolute URLs, protocol-relative "//", backslash tricks, unknown locales) falls back to the dashboard.
 */
export function safeNextPath(value: string | null | undefined, locale: string, locales: readonly string[]): string {
  const home = `/${locale}/dashboard`;
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return home;
  let url: URL;
  try {
    url = new URL(value, "http://internal.invalid");
  } catch {
    return home;
  }
  if (url.origin !== "http://internal.invalid") return home;
  const first = url.pathname.split("/")[1];
  if (!locales.includes(first)) return home;
  if (/^\/[a-z]{2}\/(login|signup|forgot-password)(\/|$)/.test(url.pathname)) return home;
  return `${url.pathname}${url.search}`;
}
