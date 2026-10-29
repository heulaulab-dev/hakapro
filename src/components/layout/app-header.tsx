"use client";

import { Search } from "@/components/kit/icons";
import { CopilotDrawer } from "@/components/ai/copilot-drawer";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { Kbd } from "@/components/ui/kbd";
import { Link } from "@/i18n/navigation";
import { useUiStore } from "@/lib/stores/ui";
import type { Density, Theme } from "@/lib/preferences";
import { AccountMenu } from "./account-menu";
import { DensityToggle, LocaleSwitch, ThemeToggle } from "./preference-controls";
import type { ViewerSummary } from "./types";

/** `aiEnabled` is resolved on the server; the copilot entry point exists only when AI is on. */
export function AppHeader({ viewer, theme, density, aiEnabled = false }: { viewer: ViewerSummary; theme: Theme; density: Density; aiEnabled?: boolean }) {
  const t = useTranslations("header");
  const openPalette = useUiStore((state) => state.setPaletteOpen);
  return (
    <header data-testid="app-header" className="relative z-20 flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/70 px-4 backdrop-blur-xl backdrop-saturate-150 md:h-[58px]">
      <Link href="/dashboard" data-testid="header-brand" aria-label={t("home")} className="-ml-1 inline-flex size-10 shrink-0 items-center justify-center md:hidden">
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
        {aiEnabled && <CopilotDrawer />}
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
