"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { TabLabel, tabTriggerClass } from "@/components/ui/tabs";
import { STOCK_TABS, stockHref } from "./nav-config";

/** Route-based stock tabs (each tab is a URL). Becomes the Tabs primitive in Step 6. */
export function StockTabsNav({ symbol }: { symbol: string }) {
  const t = useTranslations("stockTabs");
  const pathname = usePathname();
  const nav = useRef<HTMLElement>(null);
  // Deep links and swipes land on a tab that may be off-screen: keep the active one visible.
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [pathname]);
  return (
    <nav ref={nav} aria-label={t("label")} className="no-scrollbar flex snap-x snap-proximity scroll-px-4 gap-4 overflow-x-auto overscroll-x-contain px-4 max-md:[mask-image:linear-gradient(to_right,transparent,black_12px,black_calc(100%-28px),transparent)] md:px-6">
      {STOCK_TABS.map((tab) => {
        const href = stockHref(symbol, tab);
        const active = pathname === href;
        return (
          <Link
            key={tab}
            href={href}
            aria-current={active ? "page" : undefined}
            data-testid={`stock-tab-${tab}`}
            data-active={active}
            className={`${tabTriggerClass} snap-start`}
          >
            <TabLabel>{t(tab)}</TabLabel>
          </Link>
        );
      })}
    </nav>
  );
}
