import { MarketDataError } from "@/server/market/errors";

const DEFAULT_COOLDOWN_S = 60;
const MAX_COOLDOWN_S = 900;

/**
 * Stop-and-back-off after a provider 429 (MIGRATION §10). While cooling down no request is sent;
 * callers get RATE_LIMITED with the remaining wait instead of retrying in a loop. In-memory, per instance.
 */
export class ProviderBackoff {
  private blockedUntil = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Throws RATE_LIMITED without contacting the provider while a cooldown is active. */
  check(): void {
    const remainingMs = this.blockedUntil - this.now();
    if (remainingMs > 0) throw new MarketDataError("RATE_LIMITED", "Provider rate limit cooldown", 429, Math.ceil(remainingMs / 1000));
  }

  /** Records a 429; honours Retry-After (seconds), clamped to [60 s, 15 min]. Returns the cooldown in seconds. */
  trip(retryAfterSeconds?: number): number {
    const seconds = Math.min(MAX_COOLDOWN_S, Math.max(DEFAULT_COOLDOWN_S, retryAfterSeconds ?? 0));
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + seconds * 1000);
    return seconds;
  }
}
