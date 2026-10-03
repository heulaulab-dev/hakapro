import { getTranslations } from "next-intl/server";
import { resolveAuthConfig } from "@/server/config/auth";
import { isFixtureMode } from "@/server/config/market-source";

/**
 * Persistent notice for non-production data/auth modes: MARKET_DATA_SOURCE=fixture and
 * DEV_AUTH_BYPASS=1. Production can never reach either state (next.config.ts refuses to build/start).
 */
export async function FixtureBanner() {
  const fixture = isFixtureMode(process.env);
  const bypass = resolveAuthConfig(process.env).mode === "bypass";
  if (!fixture && !bypass) return null;
  const t = await getTranslations("devBanner");
  return (
    <div
      role="status"
      data-testid="fixture-banner"
      className="sticky top-0 z-50 flex items-center justify-center gap-3 border-b border-warning/40 bg-warning-muted px-4 py-1.5 text-xs font-medium text-warning"
    >
      {fixture && (
        <span>
          <span className="ticker">{t("fixture")}</span>
          <span className="ml-2 opacity-80">{t("fixtureDetail")}</span>
        </span>
      )}
      {bypass && <span data-testid="auth-bypass-banner" className="ticker">{t("authBypass")}</span>}
    </div>
  );
}
