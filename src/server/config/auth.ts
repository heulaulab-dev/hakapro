// Imported by next.config.ts, so it must stay free of `server-only` and Next runtime imports.
import { isProductionEnv } from "./market-source";

type Env = Record<string, string | undefined>;

export type AuthConfig =
  | { mode: "supabase"; url: string; key: string }
  /** Local development only, requested explicitly with DEV_AUTH_BYPASS=1. */
  | { mode: "bypass" }
  /** Development without Supabase and without the bypass: every protected request is refused. */
  | { mode: "unconfigured" };

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

/**
 * Auth fails closed. In production Supabase config is mandatory and the bypass is rejected,
 * so `next build`/`next start` cannot produce an unauthenticated app. A missing env var never
 * turns auth off; only DEV_AUTH_BYPASS=1 outside production does.
 */
export function resolveAuthConfig(env: Env): AuthConfig {
  const bypass = env.DEV_AUTH_BYPASS?.trim();
  if (bypass && bypass !== "1") throw new AuthConfigError('DEV_AUTH_BYPASS accepts only "1"');
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

  if (isProductionEnv(env)) {
    if (bypass) throw new AuthConfigError("DEV_AUTH_BYPASS is not allowed in production");
    if (!url || !key) throw new AuthConfigError("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are required in production");
    return { mode: "supabase", url, key };
  }
  if (bypass) return { mode: "bypass" };
  if (url && key) return { mode: "supabase", url, key };
  return { mode: "unconfigured" };
}

export type AccessDecision = "allow" | "unauthorized" | "not_configured";

/** Decides access for a protected server request. `hasSession` is only called in supabase mode. */
export async function decideAccess(config: AuthConfig, hasSession: () => Promise<boolean>): Promise<AccessDecision> {
  if (config.mode === "bypass") return "allow";
  if (config.mode === "unconfigured") return "not_configured";
  return (await hasSession()) ? "allow" : "unauthorized";
}
