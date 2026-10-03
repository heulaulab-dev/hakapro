import { describe, expect, test, vi } from "vitest";
import { AuthConfigError, decideAccess, resolveAuthConfig } from "./auth";

const SUPABASE = { NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.test", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable" };
const PROD = [{ NODE_ENV: "production" }, { VERCEL_ENV: "production" }, { NODE_ENV: "development", VERCEL_ENV: "production" }];

describe("auth config fails closed in production", () => {
  test.each(PROD)("%o without Supabase config is rejected", (env) => {
    expect(() => resolveAuthConfig(env)).toThrow(AuthConfigError);
    expect(() => resolveAuthConfig({ ...env, NEXT_PUBLIC_SUPABASE_URL: SUPABASE.NEXT_PUBLIC_SUPABASE_URL })).toThrow(AuthConfigError);
    expect(() => resolveAuthConfig({ ...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable" })).toThrow(AuthConfigError);
    expect(() => resolveAuthConfig({ ...env, NEXT_PUBLIC_SUPABASE_URL: " ", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: " " })).toThrow(AuthConfigError);
  });

  test.each(PROD)("%o rejects DEV_AUTH_BYPASS even with Supabase config", (env) => {
    expect(() => resolveAuthConfig({ ...env, ...SUPABASE, DEV_AUTH_BYPASS: "1" })).toThrow(/not allowed in production/);
    expect(() => resolveAuthConfig({ ...env, DEV_AUTH_BYPASS: "1" })).toThrow(AuthConfigError);
  });

  test.each(PROD)("%o with Supabase config uses Supabase", (env) => {
    expect(resolveAuthConfig({ ...env, ...SUPABASE })).toEqual({ mode: "supabase", url: SUPABASE.NEXT_PUBLIC_SUPABASE_URL, key: "publishable" });
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
    expect(resolveAuthConfig({ ...DEV, ...SUPABASE, DEV_AUTH_BYPASS: "1" })).toEqual({ mode: "bypass" });
    expect(resolveAuthConfig({ ...DEV, DEV_AUTH_BYPASS: "" })).toEqual({ mode: "unconfigured" });
  });
  test.each(["true", "yes", "0", "on"])("DEV_AUTH_BYPASS=%s is rejected rather than guessed", (value) => {
    expect(() => resolveAuthConfig({ ...DEV, DEV_AUTH_BYPASS: value })).toThrow(AuthConfigError);
  });
  test("Supabase config without bypass uses Supabase", () => {
    expect(resolveAuthConfig({ ...DEV, ...SUPABASE }).mode).toBe("supabase");
  });
});

describe("decideAccess", () => {
  test("bypass allows without consulting a session", async () => {
    const hasSession = vi.fn(async () => false);
    expect(await decideAccess({ mode: "bypass" }, hasSession)).toBe("allow");
    expect(hasSession).not.toHaveBeenCalled();
  });
  test("unconfigured is refused, never allowed", async () => {
    expect(await decideAccess({ mode: "unconfigured" }, async () => true)).toBe("not_configured");
  });
  test("supabase mode requires a session", async () => {
    const config = { mode: "supabase" as const, url: "u", key: "k" };
    expect(await decideAccess(config, async () => true)).toBe("allow");
    expect(await decideAccess(config, async () => false)).toBe("unauthorized");
  });
});
