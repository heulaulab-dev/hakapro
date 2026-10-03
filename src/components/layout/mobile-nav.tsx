"use client";

import { Bookmark, House, Menu, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet";
import { Link, usePathname } from "@/i18n/navigation";
import type { Density, Theme } from "@/lib/preferences";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import { isActive, NAV, SECONDARY } from "./nav-config";
import { DensityToggle, LocaleSwitch, ThemeToggle } from "./preference-controls";

const tab = "caption-style flex flex-1 flex-col items-center justify-center gap-1 text-subtle transition-colors duration-150 ease-power3-out aria-[current=page]:text-foreground";

/** Mobile has its own hierarchy: Home, Search, Watchlist, More — not a shrunken desktop. */
export function MobileNav({ theme, density }: { theme: Theme; density: Density }) {
  const t = useTranslations();
  const pathname = usePathname();
  const openPalette = useUiStore((state) => state.setPaletteOpen);
  const [moreOpen, setMoreOpen] = useState(false);
  const discover = NAV.find((item) => item.key === "discover")!;
  const news = NAV.find((item) => item.key === "news")!;

  return (
    <>
      <nav aria-label={t("nav.label")} data-testid="mobile-nav" className="flex h-14 shrink-0 border-t border-border bg-sidebar pb-[env(safe-area-inset-bottom)] md:hidden">
        <Link href="/" className={cn(tab, isActive(pathname, "/") && "text-foreground")} aria-current={isActive(pathname, "/") ? "page" : undefined}>
          <House className="size-4" />
          {t("nav.home")}
        </Link>
        <button type="button" className={tab} onClick={() => openPalette(true)} data-testid="mobile-search">
          <Search className="size-4" />
          {t("nav.search")}
        </button>
        <Link href="/watchlist" className={cn(tab, isActive(pathname, "/watchlist") && "text-foreground")} aria-current={isActive(pathname, "/watchlist") ? "page" : undefined}>
          <Bookmark className="size-4" />
          {t("nav.watchlist")}
        </Link>
        <button type="button" className={tab} onClick={() => setMoreOpen(true)} data-testid="mobile-more">
          <Menu className="size-4" />
          {t("nav.more")}
        </button>
      </nav>
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto" onOpenAutoFocus={(event) => event.preventDefault()}>
          <SheetHeader title={t("nav.more")} />
          <div className="flex flex-col gap-4 px-4 pb-6">
            <section>
              <h2 className="eyebrow-style mb-2 font-medium text-faint">{t("nav.discover")}</h2>
              {discover.children!.map((item) => (
                <Link key={item.key} href={item.href} onClick={() => setMoreOpen(false)} className="lead-style flex h-11 items-center gap-3 rounded-lg px-2 transition-colors hover:bg-(--overlay-soft)">
                  <item.icon className="size-3.5 text-subtle" />
                  {t(`nav.${item.key}`)}
                </Link>
              ))}
              <Link href="/news" onClick={() => setMoreOpen(false)} className="lead-style flex h-11 items-center gap-3 rounded-lg px-2 transition-colors hover:bg-(--overlay-soft)">
                <news.icon className="size-3.5 text-subtle" />
                {t("nav.news")}
              </Link>
              {SECONDARY.map((item) => (
                <Link key={item.key} href={item.href} onClick={() => setMoreOpen(false)} className="lead-style flex h-11 items-center gap-3 rounded-lg px-2 transition-colors hover:bg-(--overlay-soft)">
                  <item.icon className="size-3.5 text-subtle" />
                  {t(`nav.${item.key}`)}
                </Link>
              ))}
            </section>
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
