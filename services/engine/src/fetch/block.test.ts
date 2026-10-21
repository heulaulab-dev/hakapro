import { describe, expect, it } from "vitest";
import type { BlockEvidence } from "../../db/schema";
import { blockRetryAt, cooldownOver, detectBlock, evidenceHeaders, retryAfterMs, withCooldown } from "./block";

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

  it("flags a CloudFront 403 as a CDN block and any other 403 as a refusal", () => {
    expect(detectBlock({ status: 403, headers: new Headers({ "x-cache": "Error from cloudfront", "content-type": "text/html" }), requestUrl: URL_, body: "Request blocked" })?.reason).toBe("CDN_FORBIDDEN");
    expect(detectBlock({ status: 403, headers: new Headers({ "content-type": "application/json" }), requestUrl: URL_, body: "{}" })).toEqual({ reason: "FORBIDDEN", markers: ["status:403"] });
    expect(detectBlock({ status: 404, headers: new Headers({ "content-type": "application/json" }), requestUrl: URL_, body: "{}" })).toBeNull();
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

describe("rate-limit cooldown", () => {
  const limited = (detectedAt: string, headers: Record<string, string> = {}): BlockEvidence => ({ reason: "RATE_LIMITED", url: URL_, status: 429, markers: ["status:429"], headers, detectedAt });
  const HOUR = 3_600_000;
  const at = (iso: string, plusMs: number) => new Date(Date.parse(iso) + plusMs).toISOString();

  it("reads Retry-After as seconds or an HTTP date", () => {
    const now = Date.parse("2026-10-18T12:00:00Z");
    expect(retryAfterMs("30", now)).toBe(30_000);
    expect(retryAfterMs("Sun, 18 Oct 2026 15:00:00 GMT", now)).toBe(3 * HOUR);
    expect(retryAfterMs(undefined, now)).toBeNull();
    expect(retryAfterMs("soon", now)).toBeNull();
  });

  it("rests 2 h, then 6 h, 24 h and 72 h for rate limits in a row, then stops for good", () => {
    const first = withCooldown(limited("2026-10-18T12:00:00.000Z"), null);
    expect(first).toMatchObject({ strike: 1, retryAt: "2026-10-18T14:00:00.000Z" });
    let previous = first;
    const expected = [6, 24, 72];
    for (const [i, hours] of expected.entries()) {
      const detectedAt = at("2026-10-18T14:00:00.000Z", i * HOUR);
      previous = withCooldown(limited(detectedAt), previous);
      expect(previous).toMatchObject({ strike: i + 2, retryAt: at(detectedAt, hours * HOUR) });
    }
    const last = withCooldown(limited("2026-10-18T20:00:00.000Z"), previous);
    expect(last).toMatchObject({ strike: 5, retryAt: null });
    expect(blockRetryAt(last)).toBeNull();
    expect(cooldownOver(last, new Date("2027-01-01T00:00:00Z"))).toBe(false);
  });

  it("starts the ladder again after a quiet week, and honours a longer Retry-After", () => {
    const old = withCooldown(limited("2026-10-01T00:00:00.000Z"), null);
    expect(withCooldown(limited("2026-10-18T12:00:00.000Z"), old).strike).toBe(1);
    expect(withCooldown(limited("2026-10-18T12:00:00.000Z", { "retry-after": "18000" }), null).retryAt).toBe("2026-10-18T17:00:00.000Z");
  });

  it("never retries other blocks; keeps propagated evidence; treats a stored pre-cooldown 429 as a first strike", () => {
    const forbidden = withCooldown({ ...limited("2026-10-18T12:00:00.000Z"), reason: "FORBIDDEN", status: 403 }, null);
    expect(forbidden.retryAt).toBeNull();
    expect(cooldownOver(forbidden, new Date("2027-01-01T00:00:00Z"))).toBe(false);
    const propagated = { ...limited("2026-10-18T12:00:00.000Z"), strike: 3, retryAt: "2026-10-19T12:00:00.000Z" };
    expect(withCooldown(propagated, limited("2026-10-18T11:00:00.000Z"))).toBe(propagated);
    const legacy = limited("2026-10-18T12:00:00.000Z");
    expect(blockRetryAt(legacy)).toBe("2026-10-18T14:00:00.000Z");
    expect(cooldownOver(legacy, new Date("2026-10-18T13:59:59Z"))).toBe(false);
    expect(cooldownOver(legacy, new Date("2026-10-18T14:00:00Z"))).toBe(true);
  });
});
