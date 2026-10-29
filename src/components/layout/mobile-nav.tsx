"use client";

import { Bookmark, House, Menu, Search } from "@/components/kit/icons";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { Link, usePathname } from "@/i18n/navigation";
import type { Density, Theme } from "@/lib/preferences";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import { isActive, MODULE_GROUPS, NAV, SECONDARY, type NavItem } from "./nav-config";
import { DensityToggle, LocaleSwitch, ThemeToggle } from "./preference-controls";

const tab = "caption-style relative flex flex-1 flex-col items-center justify-center gap-1 text-subtle transition-colors duration-150 ease-power3-out before:absolute before:top-0 before:h-0.5 before:w-8 before:rounded-full before:bg-transparent aria-[current=page]:text-foreground aria-[current=page]:before:bg-foreground";
const moduleCard = "flex items-center gap-2.5 rounded-xl border border-border px-3 py-3 transition-colors hover:bg-(--overlay-soft) data-[active=true]:border-(--tag-neutral-border) data-[active=true]:bg-muted";

/** Mobile has its own hierarchy: Home, Search, Watchlist, More. "More" opens the grouped module grid (all modules). */
export function MobileNav({ theme, density }: { theme: Theme; density: Density }) {
  const t = useTranslations();
  const pathname = usePathname();
  const openPalette = useUiStore((state) => state.setPaletteOpen);
  const [moreOpen, setMoreOpen] = useState(false);
  // The More sheet holds everything that is not Home / Watchlist, so it lights up for those pages.
  const moreActive = !isActive(pathname, "/dashboard") && !isActive(pathname, "/watchlist") && !pathname.startsWith("/stock");
  const standaloneModules = NAV.filter((item) => !item.children && item.key !== "home");

  const moduleLink = (item: NavItem) => (
    <Link
      key={item.key}
      href={item.href}
      onClick={() => setMoreOpen(false)}
      data-active={isActive(pathname, item.href)}
      data-testid={`module-${item.key}`}
      className={moduleCard}
    >
      <item.icon className="size-4 shrink-0 text-subtle" />
      <span className="lead-style min-w-0 truncate">{t(`nav.${item.key}`)}</span>
    </Link>
  );

  return (
    <>
      <nav aria-label={t("nav.label")} data-testid="mobile-nav" className="flex h-14 shrink-0 border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden">
        <Link href="/dashboard" className={cn(tab, isActive(pathname, "/dashboard") && "text-foreground")} aria-current={isActive(pathname, "/dashboard") ? "page" : undefined}>
          <House className="size-5" />
          {t("nav.home")}
        </Link>
        <button type="button" className={tab} onClick={() => openPalette(true)} data-testid="mobile-search">
          <Search className="size-5" />
          {t("nav.search")}
        </button>
        <Link href="/watchlist" className={cn(tab, isActive(pathname, "/watchlist") && "text-foreground")} aria-current={isActive(pathname, "/watchlist") ? "page" : undefined}>
          <Bookmark className="size-5" />
          {t("nav.watchlist")}
        </Link>
        <button type="button" className={tab} onClick={() => setMoreOpen(true)} data-testid="mobile-more" aria-current={moreActive ? "page" : undefined}>
          <Menu className="size-5" />
          {t("nav.more")}
        </button>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto" onOpenAutoFocus={(event) => event.preventDefault()}>
          <SheetHeader title={t("nav.allModules")} />
          <div className="flex flex-col gap-5 px-4 pb-6" data-testid="all-modules">
            {MODULE_GROUPS.map((group) => (
              <section key={group.key}>
                <div className="mb-2 flex items-center gap-2">
                  <group.icon className="size-3.5 text-subtle" />
                  <h2 className="eyebrow-style font-medium text-faint">{t(`nav.${group.key}`)}</h2>
                  <span className="caption-style ml-auto text-faint">{group.children!.length}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">{group.children!.map(moduleLink)}</div>
              </section>
            ))}
            {standaloneModules.length > 0 && <section className="grid grid-cols-2 gap-2 border-t border-border pt-4">{standaloneModules.map(moduleLink)}</section>}
            <section className="grid grid-cols-2 gap-2 border-t border-border pt-4">{SECONDARY.map(moduleLink)}</section>
            <section className="flex items-center gap-1 border-t border-border pt-3">
              <span className="caption-style mr-auto text-subtle">{t("header.display")}</span>
              <LocaleSwitch />
              <ThemeToggle initial={theme} />
              <DensityToggle initial={density} />
            </section>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
