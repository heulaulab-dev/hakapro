"use client";

import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { Kbd } from "@/components/ui/kbd";
import { Link } from "@/i18n/navigation";
import { useUiStore } from "@/lib/stores/ui";
import type { Density, Theme } from "@/lib/preferences";
import { AccountMenu } from "./account-menu";
import { DensityToggle, LocaleSwitch, ThemeToggle } from "./preference-controls";
import type { ViewerSummary } from "./types";

export function AppHeader({ viewer, theme, density }: { viewer: ViewerSummary; theme: Theme; density: Density }) {
  const t = useTranslations("header");
  const openPalette = useUiStore((state) => state.setPaletteOpen);
  return (
    <header data-testid="app-header" className="flex h-[58px] shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <Link href="/dashboard" data-testid="header-brand" className="shrink-0 md:hidden">
        <Logo variant="symbol" height={28} priority />
      </Link>
      {/* Global stock search lives in the command palette; this is its desktop entry point. */}
      <button
        type="button"
        onClick={() => openPalette(true)}
        aria-label={t("searchShortcut")}
        data-testid="header-search"
        className="caption-style hidden h-[30px] w-full max-w-md items-center gap-2 rounded-full bg-secondary px-3 text-subtle shadow-(--shadow-raised) transition-[background-color,color] duration-150 ease-power3-out hover:bg-muted hover:text-soft md:flex"
      >
        <Search className="size-3.5" />
        <span className="truncate">{t("search")}</span>
        <Kbd className="ml-auto hidden lg:inline-flex">Ctrl K</Kbd>
      </button>
      <div className="ml-auto flex items-center gap-0.5">
        <div className="hidden items-center gap-0.5 md:flex">
          <LocaleSwitch />
          <ThemeToggle initial={theme} />
          <DensityToggle initial={density} />
        </div>
        <AccountMenu viewer={viewer} />
      </div>
    </header>
  );
}
