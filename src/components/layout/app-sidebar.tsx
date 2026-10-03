"use client";

import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { isActive, NAV, type NavItem } from "./nav-config";

/**
 * Desktop/tablet navigation. Pure CSS breakpoints so server and client render identically:
 * hidden below md (mobile uses MobileNav), icon rail on md–lg (tablet), full labels from xl.
 */
export function AppSidebar() {
  const t = useTranslations("nav");
  const pathname = usePathname();

  const link = (item: NavItem, nested = false) => {
    const active = isActive(pathname, item.href) || Boolean(item.children?.some((child) => isActive(pathname, child.href)));
    return (
      <Tooltip key={item.key}>
        <TooltipTrigger asChild>
          <Link
            href={item.href}
            aria-current={isActive(pathname, item.href) ? "page" : undefined}
            data-testid={`nav-${item.key}`}
            className={cn(
              "flex h-9 items-center gap-3 rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              "justify-center xl:justify-start",
              nested && "xl:h-8 xl:pl-9",
              active && "bg-accent text-foreground",
            )}
          >
            <item.icon className={cn("size-4 shrink-0", nested && "xl:hidden")} />
            <span className="sr-only xl:not-sr-only xl:truncate">{t(item.key)}</span>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right" className="xl:hidden">
          {t(item.key)}
        </TooltipContent>
      </Tooltip>
    );
  };

  return (
    <aside data-testid="app-sidebar" className="hidden w-14 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex xl:w-60">
      <div className="flex h-12 items-center justify-center border-b border-sidebar-border px-3 xl:justify-start">
        <Link href="/" className="ticker text-sm font-semibold tracking-wider text-sidebar-foreground">
          <span className="xl:hidden">HP</span>
          <span className="hidden xl:inline">HAKAPRO</span>
        </Link>
      </div>
      <nav aria-label={t("label")} className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
        {NAV.map((item) =>
          item.children ? (
            <div key={item.key} className="flex flex-col gap-0.5">
              {/* Tablet rail shows each Discover page as its own icon; desktop shows a labelled group. */}
              <span className="hidden px-2.5 pt-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase xl:block">{t(item.key)}</span>
              <span aria-hidden className="mx-2 my-1 border-t border-sidebar-border xl:hidden" />
              {item.children.map((child) => link(child, true))}
              <span aria-hidden className="mx-2 my-1 border-t border-sidebar-border xl:hidden" />
            </div>
          ) : (
            link(item)
          ),
        )}
      </nav>
    </aside>
  );
}
