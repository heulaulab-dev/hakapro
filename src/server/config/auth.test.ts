import { describe, expect, test, vi } from "vitest";
import { AuthConfigError, decideAccess, PRODUCTION_AUTH_URL, resolveAuthConfig } from "./auth";

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
