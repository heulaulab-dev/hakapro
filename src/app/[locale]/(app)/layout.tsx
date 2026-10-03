import { cookies } from "next/headers";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { CommandPalette } from "@/components/layout/command-palette";
import { MobileNav } from "@/components/layout/mobile-nav";
import { Providers } from "@/components/providers";
import { DENSITY_COOKIE, parseDensity, parseTheme, THEME_COOKIE } from "@/lib/preferences";
import { getViewer } from "@/server/viewer";

export default async function AppShellLayout({ children }: LayoutProps<"/[locale]">) {
  const [viewer, store] = await Promise.all([getViewer(), cookies()]);
  const theme = parseTheme(store.get(THEME_COOKIE)?.value);
  const density = parseDensity(store.get(DENSITY_COOKIE)?.value);
  return (
    <Providers>
      <div data-testid="app-shell" className="flex min-h-0 flex-1">
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppHeader viewer={viewer} theme={theme} density={density} />
          <main id="main" className="min-h-0 flex-1 overflow-y-auto">
            {children}
          </main>
          <MobileNav theme={theme} density={density} />
        </div>
      </div>
      <CommandPalette viewer={viewer} />
    </Providers>
  );
}
