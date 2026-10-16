import { describe, expect, it } from "vitest";
import { detectBlock, evidenceHeaders } from "./block";

const URL_ = "https://data.example.test/v1/summary";
const html = (extra: Record<string, string> = {}) => new Headers({ "content-type": "text/html; charset=UTF-8", ...extra });

// Synthetic Cloudflare interstitial (structure only; no real page content).
const CF_CHALLENGE = `<!DOCTYPE html><html><head><title>Just a moment...</title></head>
<body><div id="challenge-form"></div><script>window._cf_chl_opt={cvId:'3',cType:'managed'};</script>
<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></body></html>`;

describe("detectBlock", () => {
  it("flags a Cloudflare challenge served as 403 with cf-ray", () => {
    const result = detectBlock({ status: 403, headers: html({ "cf-ray": "8a1b2c3d4e5f-SIN", server: "cloudflare" }), requestUrl: URL_, body: CF_CHALLENGE });
    expect(result?.reason).toBe("CLOUDFLARE_CHALLENGE");
    expect(result?.markers).toContain("body:<title>just a moment...</title>");
  });

  it("flags a challenge served as 503 and via the cf-mitigated header", () => {
    expect(detectBlock({ status: 503, headers: html(), requestUrl: URL_, body: CF_CHALLENGE })?.reason).toBe("CLOUDFLARE_CHALLENGE");
    expect(detectBlock({ status: 403, headers: html({ "cf-mitigated": "challenge" }), requestUrl: URL_ })?.reason).toBe("CLOUDFLARE_CHALLENGE");
  });

  it("flags a 200 interstitial by its strong markers", () => {
    expect(detectBlock({ status: 200, headers: html(), requestUrl: URL_, body: CF_CHALLENGE })?.reason).toBe("CLOUDFLARE_CHALLENGE");
  });

  it("does not flag a normal 200 page that only loads the bot-management script", () => {
    const page = `<html><head><title>Ringkasan</title></head><body><table></table><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>`;
    expect(detectBlock({ status: 200, headers: html({ "cf-ray": "x" }), requestUrl: URL_, body: page })).toBeNull();
  });

  it("flags captcha pages", () => {
    const page = `<html><body><form><div class="g-recaptcha" data-sitekey="x"></div></form></body></html>`;
    expect(detectBlock({ status: 200, headers: html(), requestUrl: URL_, body: page })?.reason).toBe("CAPTCHA");
    expect(detectBlock({ status: 403, headers: html(), requestUrl: URL_, body: '<div class="cf-turnstile"></div>' })?.reason).toBe("CAPTCHA");
  });

  it("flags 403 + cf-ray without a body marker as a CDN block", () => {
    expect(detectBlock({ status: 403, headers: new Headers({ "cf-ray": "abc", "content-type": "application/json" }), requestUrl: URL_, body: "{}" })?.reason).toBe("CDN_FORBIDDEN");
  });

  it("treats 429 as a block (never retried)", () => {
    expect(detectBlock({ status: 429, headers: new Headers({ "retry-after": "60" }), requestUrl: URL_ })?.reason).toBe("RATE_LIMITED");
  });

  it("flags login redirects and 401", () => {
    expect(detectBlock({ status: 302, headers: new Headers({ location: "/login?next=%2Fv1" }), requestUrl: URL_, location: "/login?next=%2Fv1" })?.reason).toBe("LOGIN_REQUIRED");
    expect(detectBlock({ status: 302, headers: new Headers(), requestUrl: URL_, location: "https://sso.example.test/auth/realms/x" })?.reason).toBe("LOGIN_REQUIRED");
    expect(detectBlock({ status: 401, headers: new Headers(), requestUrl: URL_ })?.reason).toBe("LOGIN_REQUIRED");
  });

  it("ignores ordinary redirects, 404s and JSON bodies mentioning captcha", () => {
    expect(detectBlock({ status: 301, headers: new Headers(), requestUrl: URL_, location: "/v1/summary/" })).toBeNull();
    expect(detectBlock({ status: 404, headers: html(), requestUrl: URL_, body: "<h1>Not found</h1>" })).toBeNull();
    expect(detectBlock({ status: 200, headers: new Headers({ "content-type": "application/json" }), requestUrl: URL_, body: '{"note":"g-recaptcha"}' })).toBeNull();
  });

  it("keeps only allow-listed response headers as evidence", () => {
    const kept = evidenceHeaders(new Headers({ "cf-ray": "abc", "set-cookie": "__cf_bm=secret", server: "cloudflare" }));
    expect(kept).toEqual({ "cf-ray": "abc", server: "cloudflare" });
  });
});
