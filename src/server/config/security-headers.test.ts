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

test("development allows HMR and skips HSTS", () => {
  const headers = securityHeaders({ NODE_ENV: "development" });
  expect(get(headers, "Content-Security-Policy")).toContain("'unsafe-eval'");
  expect(get(headers, "Strict-Transport-Security")).toBeUndefined();
});
