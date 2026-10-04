export type MarketDataErrorCode =
  | "PROVIDER_UNAUTHORIZED"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "MALFORMED_PROVIDER_RESPONSE"
  | "INVALID_REQUEST"
  | "NOT_CONFIGURED"
  | "UNSUPPORTED"
  | "NOT_FOUND"
  | "NOT_RECORDED";

export class MarketDataError extends Error {
  constructor(
    public readonly code: MarketDataErrorCode,
    message: string,
    public readonly status: number,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

export const unsupported = (source: string, capability: string) =>
  new MarketDataError("UNSUPPORTED", `${source} does not provide ${capability}`, 503);
