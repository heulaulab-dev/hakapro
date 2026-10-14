import "server-only";
import { resolveAuthConfig } from "@/server/config/auth";
import { isProductionEnv, resolveMarketDataSource } from "@/server/config/market-source";
import { getMarketDataSource } from "@/server/market";

export type Check = { name: string; status: "ok" | "degraded" | "fail"; detail?: string };

/**
 * Readiness for load balancers and uptime checks. Reports only states and error codes — never
 * URLs, keys or provider messages.
 */
export async function readiness(): Promise<{ ready: boolean; checks: Check[] }> {
  const checks: Check[] = [];
  try {
    const auth = resolveAuthConfig(process.env);
    checks.push({ name: "auth", status: auth.mode === "better_auth" ? "ok" : auth.mode === "bypass" ? "degraded" : "fail", detail: auth.mode });
    if (auth.mode === "better_auth") {
      checks.push({ name: "google_oauth", status: auth.google ? "ok" : isProductionEnv(process.env) ? "fail" : "degraded", detail: auth.google ? "CONFIGURED" : "NOT_CONFIGURED" });
      checks.push({ name: "email_delivery", status: auth.smtp ? "ok" : isProductionEnv(process.env) ? "fail" : "degraded", detail: auth.smtp ? "CONFIGURED" : "NOT_CONFIGURED" });
    }
  } catch {
    checks.push({ name: "auth", status: "fail", detail: "INVALID_CONFIG" });
  }
  try {
    if (!process.env.DATABASE_URL && !isProductionEnv(process.env)) {
      checks.push({ name: "database", status: "degraded", detail: "NOT_CONFIGURED" });
    } else {
      const { checkDatabaseConnection } = await import("@/server/db");
      const connected = await checkDatabaseConnection();
      checks.push({ name: "database", status: connected ? "ok" : "fail", detail: connected ? "CONNECTED" : "UNREACHABLE" });
    }
  } catch {
    checks.push({ name: "database", status: "fail", detail: "UNREACHABLE" });
  }
  try {
    const mode = resolveMarketDataSource(process.env);
    checks.push({ name: "market_source", status: mode === "fixture" ? "degraded" : "ok", detail: mode });
    if (mode !== "fixture") {
      const health = await getMarketDataSource().providerHealth(AbortSignal.timeout(4000)).catch((error: unknown) => ({ error: error instanceof Error && "code" in error ? String(error.code) : "UNREACHABLE" }));
      checks.push("error" in health ? { name: "market_provider", status: "fail", detail: health.error } : { name: "market_provider", status: health.data.ok ? "ok" : "fail" });
      // Daily request quota (resets 00:00 WIB). Under 10% left is degraded, none left fails.
      const quota = "error" in health ? null : health.data.quota;
      if (quota) checks.push({ name: "provider_quota", status: quota.remaining <= 0 ? "fail" : quota.remaining < quota.limit * 0.1 ? "degraded" : "ok", detail: `${quota.remaining}/${quota.limit}` });
    }
  } catch {
    checks.push({ name: "market_source", status: "fail", detail: "INVALID_CONFIG" });
  }
  return { ready: checks.every((check) => check.status !== "fail"), checks };
}
