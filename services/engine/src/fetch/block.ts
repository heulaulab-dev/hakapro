// Block detection (DATA-ENGINE.md §2). A detected block stops the source; it is never bypassed or auto-retried.

export type BlockReason = "RATE_LIMITED" | "CLOUDFLARE_CHALLENGE" | "CDN_FORBIDDEN" | "FORBIDDEN" | "CAPTCHA" | "LOGIN_REQUIRED";
export type BlockDetection = { reason: BlockReason; markers: string[] };

export type BlockInput = {
  status: number;
  headers: Headers;
  requestUrl: string;
  /** Redirect target, for 3xx responses. */
  location?: string | null;
  /** Decoded body prefix; only inspected for HTML/text responses. */
  body?: string;
};

// Strong markers only appear on Cloudflare interstitials, so they count even on a 200.
const STRONG_CHALLENGE = ["<title>just a moment...</title>", "cf_chl_opt", "cf-browser-verification", "attention required! | cloudflare", "checking your browser before accessing"];
// Weak markers also appear on normal pages behind Cloudflare bot management; only on 403/503.
const WEAK_CHALLENGE = ["/cdn-cgi/challenge-platform/", "cf-chl-", "challenge-form"];
const CAPTCHA = ["g-recaptcha", "recaptcha/api.js", "h-captcha", "hcaptcha.com", "challenges.cloudflare.com/turnstile", "cf-turnstile"];
const LOGIN_PATH = /\/(login|log-in|signin|sign-in|sso|auth|account\/login|masuk)(\/|\?|$|\.)/i;

/** Response headers worth keeping as evidence (never request headers or cookies). */
export const EVIDENCE_HEADERS = ["cf-ray", "cf-mitigated", "server", "x-cache", "retry-after", "location", "content-type"] as const;

export function evidenceHeaders(headers: Headers): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const name of EVIDENCE_HEADERS) {
    const value = headers.get(name);
    if (value) kept[name] = value.slice(0, 300);
  }
  return kept;
}

function isLoginUrl(target: string, base: string): boolean {
  try {
    const resolved = new URL(target, base);
    return LOGIN_PATH.test(resolved.pathname + resolved.search) && !LOGIN_PATH.test(new URL(base).pathname);
  } catch {
    return false;
  }
}

export function detectBlock(input: BlockInput): BlockDetection | null {
  const { status, headers } = input;
  if (status === 429) return { reason: "RATE_LIMITED", markers: ["status:429"] };
  if (headers.get("cf-mitigated")?.toLowerCase() === "challenge") return { reason: "CLOUDFLARE_CHALLENGE", markers: ["header:cf-mitigated=challenge"] };
  if (status === 401) return { reason: "LOGIN_REQUIRED", markers: ["status:401"] };
  if (status >= 300 && status < 400 && input.location && isLoginUrl(input.location, input.requestUrl)) {
    return { reason: "LOGIN_REQUIRED", markers: [`redirect:${input.location.slice(0, 200)}`] };
  }

  const contentType = headers.get("content-type")?.toLowerCase() ?? "";
  const inspectBody = input.body !== undefined && (contentType === "" || contentType.includes("html") || contentType.includes("text/plain"));
  if (inspectBody) {
    const body = input.body!.slice(0, 65_536).toLowerCase();
    const errorStatus = status === 403 || status === 503;
    const challenge = [...STRONG_CHALLENGE, ...(errorStatus ? WEAK_CHALLENGE : [])].filter((marker) => body.includes(marker));
    if (challenge.length) return { reason: "CLOUDFLARE_CHALLENGE", markers: challenge.map((marker) => `body:${marker}`) };
    const captcha = CAPTCHA.filter((marker) => body.includes(marker));
    if (captcha.length) return { reason: "CAPTCHA", markers: captcha.map((marker) => `body:${marker}`) };
  }

  if (status === 403 && headers.has("cf-ray")) return { reason: "CDN_FORBIDDEN", markers: ["status:403", "header:cf-ray"] };
  if (status === 403 && /cloudfront/i.test(`${headers.get("x-cache") ?? ""} ${headers.get("server") ?? ""}`)) {
    return { reason: "CDN_FORBIDDEN", markers: ["status:403", "header:cloudfront"] };
  }
  // Any other 403 is a refusal too: the source stops instead of retrying (§2), until an admin unblocks it.
  if (status === 403) return { reason: "FORBIDDEN", markers: ["status:403"] };
  return null;
}
