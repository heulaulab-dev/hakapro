const KNOWN = ["invalid_credentials", "email_not_confirmed", "user_already_exists", "weak_password", "over_email_send_rate_limit", "same_password"] as const;
export type AuthErrorKey = (typeof KNOWN)[number] | "default";

/** Maps provider error codes to translated messages; raw provider text is never shown. */
export function authErrorKey(error: unknown): AuthErrorKey {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
  const betterAuthCodes: Record<string, AuthErrorKey> = {
    INVALID_EMAIL_OR_PASSWORD: "invalid_credentials",
    INVALID_PASSWORD: "invalid_credentials",
    EMAIL_NOT_VERIFIED: "email_not_confirmed",
    USER_ALREADY_EXISTS: "user_already_exists",
    PASSWORD_TOO_SHORT: "weak_password",
    TOO_MANY_REQUESTS: "over_email_send_rate_limit",
    NEW_PASSWORD_SAME_AS_OLD: "same_password",
  };
  if (code === "email_exists") return "user_already_exists";
  if (code && code in betterAuthCodes) return betterAuthCodes[code];
  return code && (KNOWN as readonly string[]).includes(code) ? (code as AuthErrorKey) : "default";
}

export const MIN_PASSWORD_LENGTH = 8;
