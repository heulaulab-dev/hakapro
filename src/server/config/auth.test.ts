import { describe, expect, test, vi } from "vitest";
import { AuthConfigError, decideAccess, DEPLOYMENT_ORIGINS, PRODUCTION_AUTH_URL, resolveAuthConfig, resolveDeploymentEnvironment } from "./auth";

const CORE = { DATABASE_URL: "postgresql://test.invalid/db", BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters", BETTER_AUTH_URL: PRODUCTION_AUTH_URL };
const GOOGLE = { GOOGLE_CLIENT_ID: "test-client-id", GOOGLE_CLIENT_SECRET: "test-client-secret" };
const SMTP = { SMTP_HOST: "mail.test.invalid", SMTP_PORT: "465", SMTP_USER: "test-user", SMTP_PASSWORD: "test-password", SMTP_FROM: "test@test.invalid" };
const PROD = [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }, { NODE_ENV: "development", VERCEL_ENV: "production" }];

describe("auth config fails closed in production", () => {
  test.each(PROD)("%o requires Better Auth core and Google configuration", (env) => {
    expect(() => resolveAuthConfig(env)).toThrow(AuthConfigError);
    expect(() => resolveAuthConfig({ ...env, ...CORE })).toThrow(/GOOGLE_CLIENT_ID/);
    expect(resolveAuthConfig({ ...env, ...CORE, ...GOOGLE }).mode).toBe("better_auth");
  });

  test.each(PROD)("%o rejects DEV_AUTH_BYPASS", (env) => {
    expect(() => resolveAuthConfig({ ...env, ...CORE, ...GOOGLE, DEV_AUTH_BYPASS: "1" })).toThrow(/not allowed in production/);
  });

  test("email/password is enabled only with complete SMTP configuration", () => {
    const config = resolveAuthConfig({ NODE_ENV: "production", ...CORE, ...GOOGLE });
    expect(config.mode === "better_auth" && config.smtp).toBeNull();
    expect(() => resolveAuthConfig({ NODE_ENV: "production", ...CORE, ...GOOGLE, SMTP_HOST: SMTP.SMTP_HOST })).toThrow(AuthConfigError);
    const enabled = resolveAuthConfig({ NODE_ENV: "production", ...CORE, ...GOOGLE, ...SMTP });
    expect(enabled.mode === "better_auth" && enabled.smtp?.port).toBe(465);
  });
});

describe("deployment environments", () => {
  const deployed = (environment: string, url: string) => ({ NODE_ENV: "production", ...CORE, ...GOOGLE, BETTER_AUTH_ENVIRONMENT: environment, BETTER_AUTH_URL: url });

  test.each(Object.entries(DEPLOYMENT_ORIGINS))("%s accepts only its own origin", (environment, origin) => {
    const config = resolveAuthConfig(deployed(environment, origin));
    expect(config.mode === "better_auth" && config.baseUrl).toBe(origin);
    for (const other of Object.values(DEPLOYMENT_ORIGINS).filter((value) => value !== origin)) {
      expect(() => resolveAuthConfig(deployed(environment, other))).toThrow(new RegExp(`BETTER_AUTH_URL must be ${origin}`));
    }
  });

  test("unset selects production", () => {
    expect(resolveDeploymentEnvironment({})).toBe("production");
    expect(resolveDeploymentEnvironment({ BETTER_AUTH_ENVIRONMENT: " staging " })).toBe("staging");
  });

  test.each(["prod", "dev", "preview", "Staging"])("BETTER_AUTH_ENVIRONMENT=%s is rejected", (value) => {
    expect(() => resolveDeploymentEnvironment({ BETTER_AUTH_ENVIRONMENT: value })).toThrow(AuthConfigError);
  });

  test("rehearsal may not reuse a branch origin", () => {
    const rehearsal = (url: string) => ({ ...deployed("rehearsal", url), BETTER_AUTH_REHEARSAL_URL: url });
    expect(resolveAuthConfig(rehearsal("https://rehearsal.test.invalid")).mode).toBe("better_auth");
    expect(() => resolveAuthConfig(rehearsal(DEPLOYMENT_ORIGINS.staging))).toThrow(AuthConfigError);
  });

  test("local development keeps its own origin", () => {
    const config = resolveAuthConfig({ NODE_ENV: "development", ...CORE, BETTER_AUTH_ENVIRONMENT: "develop", BETTER_AUTH_URL: "http://localhost:3200" });
    expect(config.mode === "better_auth" && config.baseUrl).toBe("http://localhost:3200");
  });
});

describe("development", () => {
  const DEV = { NODE_ENV: "development" };
  test("missing config is unconfigured, never open", () => {
    expect(resolveAuthConfig(DEV)).toEqual({ mode: "unconfigured" });
    expect(resolveAuthConfig({})).toEqual({ mode: "unconfigured" });
  });
  test("bypass only with DEV_AUTH_BYPASS=1", () => {
    expect(resolveAuthConfig({ ...DEV, DEV_AUTH_BYPASS: "1" })).toEqual({ mode: "bypass" });
    expect(resolveAuthConfig({ ...DEV, ...CORE, DEV_AUTH_BYPASS: "1" })).toEqual({ mode: "bypass" });
  });
  test.each(["true", "yes", "0", "on"])("DEV_AUTH_BYPASS=%s is rejected", (value) => {
    expect(() => resolveAuthConfig({ ...DEV, DEV_AUTH_BYPASS: value })).toThrow(AuthConfigError);
  });
});

describe("decideAccess", () => {
  test("bypass allows without consulting a session", async () => {
    const hasSession = vi.fn(async () => false);
    expect(await decideAccess({ mode: "bypass" }, hasSession)).toBe("allow");
    expect(hasSession).not.toHaveBeenCalled();
  });
  test("unconfigured is refused", async () => {
    expect(await decideAccess({ mode: "unconfigured" }, async () => true)).toBe("not_configured");
  });
  test("Better Auth mode requires a session", async () => {
    const config = resolveAuthConfig({ NODE_ENV: "development", ...CORE });
    expect(await decideAccess(config, async () => true)).toBe("allow");
    expect(await decideAccess(config, async () => false)).toBe("unauthorized");
  });
});
