import type { QuotaSnapshot } from "./quota";

/** The user's daily AI limit is used up (or too many failed attempts today). Routes answer 429. */
export class AiQuotaExceededError extends Error {
  readonly code = "AI_QUOTA_EXCEEDED";
  constructor(readonly reason: "QUOTA_EXCEEDED" | "ATTEMPTS_EXCEEDED", readonly quota: QuotaSnapshot) {
    super("Daily AI limit reached");
    this.name = "AiQuotaExceededError";
  }
}

/** The Claude API call failed (timeout, rate limit, auth, 5xx). The code never carries the SDK message. */
export class AiRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "AiRequestError";
  }
}
