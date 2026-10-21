// Block detection (DATA-ENGINE.md §2). A detected block stops the source; it is never bypassed. A rate limit (429)
// rests the source on a cooldown ladder and then lets it try again; every other block waits for an admin unblock.
import type { BlockEvidence } from "../../db/schema";

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

/** Rest after the 1st, 2nd, … rate limit in a row. One more than the ladder stops the source until an admin unblocks it. */
export const RATE_LIMIT_COOLDOWNS_MS = [2, 6, 24, 72].map((hours) => hours * 3_600_000);
/** A rate limit more than this long after the previous one starts the ladder again. */
export const RATE_LIMIT_STRIKE_WINDOW_MS = 7 * 86_400_000;

/** `Retry-After` in ms from `now` (delta seconds or an HTTP date); null when absent or unreadable. */
export function retryAfterMs(value: string | undefined, now: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * Adds the cooldown to a new block: for a rate limit, the strike count (continuing the previous rate limit's when it
 * was within the strike window) and the time it may try again, the ladder step or the server's Retry-After, whichever
 * is later. Past the ladder, `retryAt` is null: the source stays blocked. Evidence that already carries a strike
 * (propagated from another source on the same host) is kept as is. Other blocks never retry.
 */
export function withCooldown(evidence: BlockEvidence, previous: BlockEvidence | null): BlockEvidence {
  if (evidence.reason !== "RATE_LIMITED") return { ...evidence, retryAt: null };
  if (evidence.strike !== undefined) return evidence;
  const detectedAt = Date.parse(evidence.detectedAt);
  const continues = previous?.reason === "RATE_LIMITED" && detectedAt - Date.parse(previous.detectedAt) <= RATE_LIMIT_STRIKE_WINDOW_MS;
  const strike = continues ? (previous.strike ?? 1) + 1 : 1;
  const step = RATE_LIMIT_COOLDOWNS_MS[strike - 1];
  if (step === undefined) return { ...evidence, strike, retryAt: null };
  const wait = Math.max(step, retryAfterMs(evidence.headers["retry-after"], detectedAt) ?? 0);
  return { ...evidence, strike, retryAt: new Date(detectedAt + wait).toISOString() };
}

/** When a block may try again, or null if only an admin unblock lifts it. Rate limits stored before the cooldown existed count as a first strike. */
export function blockRetryAt(evidence: BlockEvidence | null): string | null {
  if (evidence?.reason !== "RATE_LIMITED") return null;
  if (evidence.strike === undefined) return new Date(Date.parse(evidence.detectedAt) + RATE_LIMIT_COOLDOWNS_MS[0]).toISOString();
  return evidence.retryAt ?? null;
}

export function cooldownOver(evidence: BlockEvidence | null, now: Date): boolean {
  const retryAt = blockRetryAt(evidence);
  return retryAt !== null && now.getTime() >= Date.parse(retryAt);
}
