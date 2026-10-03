"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { STOCK_TABS, stockHref } from "./nav-config";

/** Route-based stock tabs (each tab is a URL). Becomes the Tabs primitive in Step 6. */
export function StockTabsNav({ symbol }: { symbol: string }) {
  const t = useTranslations("stockTabs");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="-mx-4 flex gap-1 overflow-x-auto border-b border-border px-4 md:-mx-6 md:px-6">
      {STOCK_TABS.map((tab) => {
        const href = stockHref(symbol, tab);
        const active = pathname === href;
        return (
          <Link
            key={tab}
            href={href}
            aria-current={active ? "page" : undefined}
            data-testid={`stock-tab-${tab}`}
            className={cn("-mb-px border-b-2 border-transparent px-2.5 py-2 text-sm whitespace-nowrap text-muted-foreground hover:text-foreground", active && "border-primary text-foreground")}
          >
            {t(tab)}
          </Link>
        );
      })}
    </nav>
  );
}
