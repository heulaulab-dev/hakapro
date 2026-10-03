import { expect, test } from "vitest";
import { ApiError } from "@/lib/api/envelope";
import { shouldRetry } from "./client";

test("permanent errors are not retried; transient 5xx are, at most twice", () => {
  expect(shouldRetry(0, new ApiError("UNSUPPORTED", 503))).toBe(false);
  expect(shouldRetry(0, new ApiError("NOT_RECORDED", 404))).toBe(false);
  expect(shouldRetry(0, new ApiError("AUTH_NOT_CONFIGURED", 503))).toBe(false);
  expect(shouldRetry(0, new ApiError("PROVIDER_UNAVAILABLE", 503))).toBe(true);
  expect(shouldRetry(2, new ApiError("PROVIDER_UNAVAILABLE", 503))).toBe(false);
  expect(shouldRetry(0, new TypeError("network"))).toBe(true);
});
