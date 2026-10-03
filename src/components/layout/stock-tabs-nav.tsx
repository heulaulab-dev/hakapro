"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { TabLabel, tabTriggerClass } from "@/components/ui/tabs";
import { STOCK_TABS, stockHref } from "./nav-config";

/** Route-based stock tabs (each tab is a URL). Becomes the Tabs primitive in Step 6. */
export function StockTabsNav({ symbol }: { symbol: string }) {
  const t = useTranslations("stockTabs");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto border-b border-border px-4 md:-mx-6 md:px-6">
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
            className={tabTriggerClass}
          >
            <TabLabel>{t(tab)}</TabLabel>
          </Link>
        );
      })}
    </nav>
  );
}
