// Imported by next.config.ts: no server-only/Next runtime imports.

type Env = Record<string, string | undefined>;

/**
 * Response security headers. Auth and user data use same-origin routes;
 * market data only ever comes from our own BFF.
 * TODO(hardening): move script-src from 'unsafe-inline' to per-request nonces via the proxy.
 */
export function securityHeaders(env: Env): Array<{ key: string; value: string }> {
  const production = env.NODE_ENV === "production";
  const csp = [
    "default-src 'self'",
    // Dev needs eval for React refresh; production does not.
    `script-src 'self' 'unsafe-inline' https://edge-cdn.trakteer.id${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://edge-cdn.trakteer.id",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self'${production ? "" : " ws: http://localhost:*"}`,
    "frame-src https://trakteer.id",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
  const headers = [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ];
  if (production) headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" });
  return headers;
}
