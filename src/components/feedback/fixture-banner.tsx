import { isFixtureMode } from "@/server/config/market-source";

/**
 * Persistent notice while MARKET_DATA_SOURCE=fixture. Rendered on the server for every page;
 * production can never reach this state (next.config.ts refuses to build or start).
 * TODO(step 4): move copy into next-intl messages.
 */
export function FixtureBanner() {
  if (!isFixtureMode(process.env)) return null;
  return (
    <div
      role="status"
      data-testid="fixture-banner"
      className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-amber-500/40 bg-amber-500/15 px-4 py-1.5 text-xs font-medium text-amber-200"
    >
      <span className="font-mono tracking-wide">FIXTURE DATA</span>
      <span className="text-amber-200/80">Recorded samples, not current market data.</span>
    </div>
  );
}
