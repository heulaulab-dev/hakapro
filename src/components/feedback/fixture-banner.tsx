import { resolveAuthConfig } from "@/server/config/auth";
import { isFixtureMode } from "@/server/config/market-source";

/**
 * Persistent notice for non-production data/auth modes: MARKET_DATA_SOURCE=fixture and
 * DEV_AUTH_BYPASS=1. Production can never reach either state (next.config.ts refuses to build/start).
 * TODO(step 4): move copy into next-intl messages.
 */
export function FixtureBanner() {
  const fixture = isFixtureMode(process.env);
  const bypass = resolveAuthConfig(process.env).mode === "bypass";
  if (!fixture && !bypass) return null;
  return (
    <div
      role="status"
      data-testid="fixture-banner"
      className="sticky top-0 z-50 flex items-center justify-center gap-3 border-b border-amber-500/40 bg-amber-500/15 px-4 py-1.5 text-xs font-medium text-amber-200"
    >
      {fixture && (
        <span>
          <span className="font-mono tracking-wide">FIXTURE DATA</span>
          <span className="ml-2 text-amber-200/80">Recorded samples, not current market data.</span>
        </span>
      )}
      {bypass && <span data-testid="auth-bypass-banner" className="font-mono tracking-wide">AUTH BYPASS</span>}
    </div>
  );
}
