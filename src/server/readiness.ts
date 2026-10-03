import "server-only";
import { resolveAuthConfig } from "@/server/config/auth";
import { resolveMarketDataSource } from "@/server/config/market-source";
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
    checks.push({ name: "auth", status: auth.mode === "supabase" ? "ok" : auth.mode === "bypass" ? "degraded" : "fail", detail: auth.mode });
  } catch {
    checks.push({ name: "auth", status: "fail", detail: "INVALID_CONFIG" });
  }
  try {
    const mode = resolveMarketDataSource(process.env);
    checks.push({ name: "market_source", status: mode === "fixture" ? "degraded" : "ok", detail: mode });
    if (mode !== "fixture") {
      const health = await getMarketDataSource().providerHealth(AbortSignal.timeout(4000)).catch((error: unknown) => ({ error: error instanceof Error && "code" in error ? String(error.code) : "UNREACHABLE" }));
      checks.push("error" in health ? { name: "market_provider", status: "fail", detail: health.error } : { name: "market_provider", status: health.data.ok ? "ok" : "fail" });
    }
  } catch {
    checks.push({ name: "market_source", status: "fail", detail: "INVALID_CONFIG" });
  }
  return { ready: checks.every((check) => check.status !== "fail"), checks };
}
