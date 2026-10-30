import { cookies } from "next/headers";
import { OfflineBanner } from "@/components/feedback/offline-banner";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CommandPalette } from "@/components/layout/command-palette";
import { MobileNav } from "@/components/layout/mobile-nav";
import { ActionCenter } from "@/components/market/action-center";
import { MarketTicker } from "@/components/market/market-ticker";
import { Providers } from "@/components/providers";
import { TrakteerTipOverlay } from "@/components/market/trakteer-tip-overlay";
import { DENSITY_COOKIE, parseDensity, parseTheme, THEME_COOKIE } from "@/lib/preferences";
import { getTranslations } from "next-intl/server";
import { isAiEnabled } from "@/server/config/ai";
import { getViewer } from "@/server/viewer";

export default async function AppShellLayout({ children }: LayoutProps<"/[locale]">) {
  const [viewer, store] = await Promise.all([getViewer(), cookies()]);
  const theme = parseTheme(store.get(THEME_COOKIE)?.value);
  const density = parseDensity(store.get(DENSITY_COOKIE)?.value);
  const t = await getTranslations("errors");
  return (
    <Providers>
      <a href="#main" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2">
        {t("skipToContent")}
      </a>
      <div data-testid="app-shell" className="flex min-h-0 flex-1">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <OfflineBanner />
          <AppHeader viewer={viewer} theme={theme} density={density} aiEnabled={isAiEnabled()} />
          <MarketTicker />
          <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
            {children}
          </main>
          <MobileNav theme={theme} density={density} />
        </div>
      </div>
      <ActionCenter />
      <CommandPalette viewer={viewer} />
      <TrakteerTipOverlay />
    </Providers>
  );
}
