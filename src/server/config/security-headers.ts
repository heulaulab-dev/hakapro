// Imported by next.config.ts: no server-only/Next runtime imports.

type Env = Record<string, string | undefined>;

/**
 * Response security headers. The CSP allows Supabase (auth/data, incl. realtime websockets) and
 * nothing else external; market data only ever comes from our own BFF.
 * TODO(hardening): move script-src from 'unsafe-inline' to per-request nonces via the proxy.
 */
export function securityHeaders(env: Env): Array<{ key: string; value: string }> {
  const production = env.NODE_ENV === "production";
  const supabase = env.NEXT_PUBLIC_SUPABASE_URL ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin : null;
  const connect = ["'self'", supabase, supabase?.replace(/^https:/, "wss:")].filter(Boolean).join(" ");
  const csp = [
    "default-src 'self'",
    // Dev needs eval for React refresh; production does not.
    `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect}${production ? "" : " ws: http://localhost:*"}`,
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
