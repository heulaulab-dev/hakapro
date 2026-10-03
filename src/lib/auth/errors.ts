const KNOWN = ["invalid_credentials", "email_not_confirmed", "user_already_exists", "weak_password", "over_email_send_rate_limit", "same_password"] as const;
export type AuthErrorKey = (typeof KNOWN)[number] | "default";

/** Maps a Supabase AuthError to a message key; provider messages are never shown verbatim. */
export function authErrorKey(error: unknown): AuthErrorKey {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : null;
  if (code === "email_exists") return "user_already_exists";
  return code && (KNOWN as readonly string[]).includes(code) ? (code as AuthErrorKey) : "default";
}

export const MIN_PASSWORD_LENGTH = 8;
