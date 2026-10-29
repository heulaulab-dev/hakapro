// Ticker-logo SVG checks shared by the engine (/v1/logos, before caching) and the app (/api/logos, before serving
// from our origin). Pure and dependency-free so both sides import the same rules (HAKA-74).

/** Ticker logos are ~1.5 KB; anything near this is not a ticker logo. */
export const MAX_LOGO_BYTES = 64 * 1024;

// SVG can carry script and external references. These never appear in a plain vector logo, so any of them rejects
// the file outright (it is treated as no logo) instead of being rewritten.
const FORBIDDEN: Array<[RegExp, string]> = [
  [/<\s*script/i, "script"],
  [/<\s*foreignobject/i, "foreignObject"],
  [/<\s*(iframe|embed|object|audio|video|image)\b/i, "embedded element"],
  [/<!\s*(doctype|entity)/i, "doctype/entity"],
  [/<\?xml-stylesheet/i, "stylesheet PI"],
  [/[\s"'/;]on[a-z]+\s*=/i, "event handler"],
  [/(java|vb)script\s*:/i, "script URL"],
  [/data\s*:\s*(text|application)\//i, "data URL"],
  [/(?:xlink:)?href\s*=\s*["']?\s*(?!#)[^\s"'>]/i, "external reference"],
  [/url\(\s*["']?\s*(?!#)[^\s"')]/i, "external url()"],
  [/@import/i, "@import"],
];

export type SanitizeResult = { ok: true; svg: string } | { ok: false; reason: string };

/** Accepts a fetched body as a logo only if it is a small, script-free SVG served as image/svg+xml. */
export function sanitizeSvg(body: Uint8Array, contentType: string | null): SanitizeResult {
  if (!/^image\/svg\+xml(\s*;|$)/i.test((contentType ?? "").trim())) return { ok: false, reason: "content-type" };
  if (body.byteLength === 0 || body.byteLength > MAX_LOGO_BYTES) return { ok: false, reason: "size" };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return { ok: false, reason: "encoding" };
  }
  if (!/<svg[\s>]/i.test(text)) return { ok: false, reason: "not svg" };
  for (const [pattern, reason] of FORBIDDEN) if (pattern.test(text)) return { ok: false, reason };
  return { ok: true, svg: text };
}
