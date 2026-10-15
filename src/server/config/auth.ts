// Imported by next.config.ts, so keep this module free of Next runtime imports.
import { isProductionEnv } from "./market-source";

type Env = Record<string, string | undefined>;

/** Deployed origin per long-lived branch: develop, staging, main (production). */
export const DEPLOYMENT_ORIGINS = {
  production: "https://hakapro.heulaulab.xyz",
  staging: "https://staging-hakapro.heulaulab.xyz",
  develop: "https://dev-hakapro.heulaulab.xyz",
} as const;
export const PRODUCTION_AUTH_URL = DEPLOYMENT_ORIGINS.production;
/** "rehearsal" is the migration-only deployment; its origin comes from BETTER_AUTH_REHEARSAL_URL. */
export type DeploymentEnvironment = keyof typeof DEPLOYMENT_ORIGINS | "rehearsal";
const DEPLOYMENT_ENVIRONMENTS: readonly string[] = [...Object.keys(DEPLOYMENT_ORIGINS), "rehearsal"];

type SmtpConfig = { host: string; port: number; secure: boolean; user: string; password: string; from: string };
export type AuthConfig =
  | { mode: "better_auth"; baseUrl: string; secret: string; google: { clientId: string; clientSecret: string } | null; smtp: SmtpConfig | null }
  | { mode: "bypass" }
  | { mode: "unconfigured" };

export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

/** Unset means production; every deployment runs with NODE_ENV=production, so this selects the origin. */
export function resolveDeploymentEnvironment(env: Env): DeploymentEnvironment {
  const environment = env.BETTER_AUTH_ENVIRONMENT?.trim() || "production";
  if (!DEPLOYMENT_ENVIRONMENTS.includes(environment)) {
    throw new AuthConfigError(`BETTER_AUTH_ENVIRONMENT accepts only ${DEPLOYMENT_ENVIRONMENTS.map((name) => `"${name}"`).join(", ")}`);
  }
  return environment as DeploymentEnvironment;
}

/** Missing credentials disable their provider; incomplete pairs fail closed. */
export function resolveAuthConfig(env: Env): AuthConfig {
  const production = isProductionEnv(env);
  const environment = resolveDeploymentEnvironment(env);
  const rehearsalUrl = env.BETTER_AUTH_REHEARSAL_URL?.trim().replace(/\/$/, "");
  if (environment === "rehearsal") {
    let parsedRehearsalUrl: URL;
    try { parsedRehearsalUrl = new URL(rehearsalUrl || ""); } catch {
      throw new AuthConfigError("BETTER_AUTH_REHEARSAL_URL must be an HTTPS origin");
    }
    if (parsedRehearsalUrl.protocol !== "https:" || parsedRehearsalUrl.origin !== rehearsalUrl || Object.values<string>(DEPLOYMENT_ORIGINS).includes(rehearsalUrl)) {
      throw new AuthConfigError("BETTER_AUTH_REHEARSAL_URL must be an HTTPS origin different from the production, staging and develop origins");
    }
  } else if (rehearsalUrl) {
    throw new AuthConfigError('BETTER_AUTH_REHEARSAL_URL requires BETTER_AUTH_ENVIRONMENT="rehearsal"');
  }
  const bypass = env.DEV_AUTH_BYPASS?.trim();
  if (bypass && bypass !== "1") throw new AuthConfigError('DEV_AUTH_BYPASS accepts only "1"');
  if (production && bypass) throw new AuthConfigError("DEV_AUTH_BYPASS is not allowed in production");
  if (bypass) return { mode: "bypass" };

  const secret = env.BETTER_AUTH_SECRET?.trim();
  const databaseUrl = env.DATABASE_URL?.trim();
  const baseUrl = (env.BETTER_AUTH_URL?.trim() || (production ? "" : "http://localhost:3000")).replace(/\/$/, "");
  if (!secret || !databaseUrl || !baseUrl) {
    if (production) throw new AuthConfigError("DATABASE_URL, BETTER_AUTH_SECRET, and BETTER_AUTH_URL are required in production");
    return { mode: "unconfigured" };
  }
  if (secret.length < 32) throw new AuthConfigError("BETTER_AUTH_SECRET must be at least 32 characters");
  let parsedUrl: URL;
  try { parsedUrl = new URL(baseUrl); } catch { throw new AuthConfigError("BETTER_AUTH_URL must be a valid origin"); }
  const requiredOrigin = environment === "rehearsal" ? rehearsalUrl : production ? DEPLOYMENT_ORIGINS[environment] : undefined;
  if (parsedUrl.origin !== baseUrl || !["http:", "https:"].includes(parsedUrl.protocol) || (requiredOrigin && baseUrl !== requiredOrigin)) {
    throw new AuthConfigError(`BETTER_AUTH_URL must be ${requiredOrigin || "an HTTP(S) origin without a path"}`);
  }

  const googleId = env.GOOGLE_CLIENT_ID?.trim();
  const googleSecret = env.GOOGLE_CLIENT_SECRET?.trim();
  if (Boolean(googleId) !== Boolean(googleSecret)) throw new AuthConfigError("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured together");
  const google = googleId && googleSecret ? { clientId: googleId, clientSecret: googleSecret } : null;

  const smtpNames = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"] as const;
  const smtpValues = smtpNames.map((name) => env[name]?.trim());
  const anySmtp = smtpValues.some(Boolean);
  if (anySmtp && smtpValues.some((value) => !value)) throw new AuthConfigError("SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM must be configured together");
  const port = Number(env.SMTP_PORT);
  if (anySmtp && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new AuthConfigError("SMTP_PORT must be between 1 and 65535");
  const secureValue = env.SMTP_SECURE?.trim();
  if (secureValue && secureValue !== "1" && secureValue !== "0") throw new AuthConfigError('SMTP_SECURE accepts only "1" or "0"');
  const smtp = anySmtp ? { host: smtpValues[0]!, port, secure: secureValue ? secureValue === "1" : port === 465, user: smtpValues[2]!, password: smtpValues[3]!, from: smtpValues[4]! } : null;
  if (production && !google) throw new AuthConfigError("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required in production");
  return { mode: "better_auth", baseUrl, secret, google, smtp };
}

export type AccessDecision = "allow" | "unauthorized" | "not_configured";
export async function decideAccess(config: AuthConfig, hasSession: () => Promise<boolean>): Promise<AccessDecision> {
  if (config.mode === "bypass") return "allow";
  if (config.mode === "unconfigured") return "not_configured";
  return (await hasSession()) ? "allow" : "unauthorized";
}
