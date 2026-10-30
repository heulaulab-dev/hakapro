import { expect, test } from "vitest";
import { securityHeaders } from "./security-headers";

const get = (headers: ReturnType<typeof securityHeaders>, key: string) => headers.find((header) => header.key === key)?.value;

test("production: strict same-origin CSP, HSTS on", () => {
  const headers = securityHeaders({ NODE_ENV: "production" });
  const csp = get(headers, "Content-Security-Policy")!;
  expect(csp).toContain("connect-src 'self';");
  expect(csp).not.toContain("unsafe-eval");
  expect(csp).toContain("frame-ancestors 'none'");
  expect(get(headers, "Strict-Transport-Security")).toMatch(/max-age=/);
});

test("production: allows only the Trakteer embed's required hosts", () => {
  const csp = get(securityHeaders({ NODE_ENV: "production" }), "Content-Security-Policy")!;
  expect(csp).toContain("script-src 'self' 'unsafe-inline' https://edge-cdn.trakteer.id;");
  expect(csp).toContain("img-src 'self' data: blob: https://edge-cdn.trakteer.id;");
  expect(csp).toContain("frame-src https://trakteer.id;");
  expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;");
  expect(csp).toContain("font-src 'self' data: https://fonts.gstatic.com;");
  expect(csp).toContain("connect-src 'self';");
});

test("development allows HMR and skips HSTS", () => {
  const headers = securityHeaders({ NODE_ENV: "development" });
  expect(get(headers, "Content-Security-Policy")).toContain("'unsafe-eval'");
  expect(get(headers, "Strict-Transport-Security")).toBeUndefined();
});
