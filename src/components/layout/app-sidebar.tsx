"use client";

import { CandlestickChart } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link, usePathname } from "@/i18n/navigation";
import { isActive, NAV, type NavItem } from "./nav-config";

// Item and icon styles from heulaulab-dashboard's sidebar (raised active row, thin subtle icons).
const itemClass =
  "group inline-flex h-[30px] w-full shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg p-2 py-0 text-[14px] leading-none font-medium whitespace-nowrap text-sidebar-foreground outline-none select-none transition-[background-color,color,box-shadow] duration-150 ease-power3-out hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 xl:justify-start data-[active=true]:h-8 data-[active=true]:bg-sidebar-primary data-[active=true]:text-foreground data-[active=true]:shadow-[0px_0px_0px_1px_rgba(0,0,0,0.4),inset_0px_1px_0px_0px_rgba(255,255,255,0.1),inset_0px_0px_0px_1px_rgba(255,255,255,0.06)]";
const iconClass = "size-3.5 shrink-0 text-subtle transition-colors duration-150 ease-power3-out group-hover:text-icon group-data-[active=true]:text-icon";

/**
 * Desktop/tablet navigation. Pure CSS breakpoints so server and client render identically:
 * hidden below md (mobile uses MobileNav), icon rail on md–lg (tablet), full sidebar from xl.
 */
export function AppSidebar() {
  const t = useTranslations();
  const pathname = usePathname();

  const link = (item: NavItem) => {
    const active = isActive(pathname, item.href);
    return (
      <li key={item.key}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Link href={item.href} data-active={active} aria-current={active ? "page" : undefined} data-testid={`nav-${item.key}`} className={itemClass}>
              <item.icon className={iconClass} />
              <span className="sr-only xl:not-sr-only xl:min-w-0 xl:flex-1 xl:truncate xl:text-left">{t(`nav.${item.key}`)}</span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" className="xl:hidden">{t(`nav.${item.key}`)}</TooltipContent>
        </Tooltip>
      </li>
    );
  };

  return (
    <aside data-testid="app-sidebar" className="hidden w-14 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex xl:w-(--sidebar-width)">
      <Link href="/" className="flex shrink-0 items-center justify-center gap-2 border-b border-sidebar-border bg-sidebar-accent p-3 xl:justify-start">
        <span className="relative flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-muted shadow-[0px_0px_0px_1px_var(--border),0px_4px_4px_0px_rgba(15,15,15,0.24)]">
          <CandlestickChart className="size-3.5 text-icon" />
        </span>
        <span className="hidden min-w-0 flex-col gap-1 xl:flex">
          <span className="lead-style block truncate font-medium tracking-[-0.01em]">{t("app.name")}</span>
          <span className="caption-style block truncate text-subtle">{t("app.tagline")}</span>
        </span>
      </Link>
      <nav aria-label={t("nav.label")} className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {NAV.map((item) =>
          item.children ? (
            <div key={item.key} className="flex flex-col gap-1 border-b border-sidebar-border p-2 xl:p-3">
              <span className="eyebrow-style hidden font-medium text-faint xl:block">{t(`nav.${item.key}`)}</span>
              <ul className="flex flex-col">{item.children.map(link)}</ul>
            </div>
          ) : (
            <ul key={item.key} className="flex flex-col border-b border-sidebar-border p-2 xl:p-3">{link(item)}</ul>
          ),
        )}
      </nav>
    </aside>
  );
}
