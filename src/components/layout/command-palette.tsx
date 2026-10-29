"use client";

import { useQuery } from "@tanstack/react-query";
import { CornerDownLeft, FileText, Filter, LineChart } from "@/components/kit/icons";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { FreshnessBadge } from "@/components/feedback/freshness-badge";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command";
import { TickerLogo } from "@/components/market/ticker-logo";
import { usePathname, useRouter } from "@/i18n/navigation";
import { marketApi } from "@/lib/api/market";
import { queryKeys } from "@/lib/query/keys";
import { useUiStore } from "@/lib/stores/ui";
import { useSavedScreens } from "@/lib/saved-screens";
import type { ViewerSummary } from "./types";
import { ALL_PAGES, STOCK_TABS, stockHref } from "./nav-config";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const TICKER = /^[A-Z0-9]{1,12}$/;

/**
 * Cmd/Ctrl+K: stock search, every page, stock tabs, saved screens. This is where terminal-style
 * shortcuts live; it is never the primary navigation.
 */
export function CommandPalette({ viewer }: { viewer: ViewerSummary }) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const { paletteOpen: open, setPaletteOpen: setOpen, togglePalette } = useUiStore();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query.trim(), 200);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        togglePalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePalette]);

  const search = useQuery({
    queryKey: queryKeys.search(debounced),
    queryFn: ({ signal }) => marketApi.search(debounced, signal),
    enabled: open && debounced.length > 0,
  });

  const savedScreens = useSavedScreens(viewer.kind === "user" ? viewer.id : null, open);

  const currentSymbol = /^\/stock\/([A-Z0-9]{1,12})(?:\/|$)/.exec(pathname)?.[1];
  const topResult = search.data?.data[0]?.symbol;
  const typedTicker = TICKER.test(debounced.toUpperCase()) ? debounced.toUpperCase() : undefined;
  const tabsSymbol = currentSymbol ?? topResult ?? typedTicker;

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title={t("palette.title")} description={t("palette.description")}>
      <Command loop>
        <CommandInput value={query} onValueChange={setQuery} placeholder={t("palette.placeholder")} data-testid="palette-input" />
        <CommandList>
          <CommandEmpty>{search.isFetching ? t("palette.searching") : t("palette.noResults")}</CommandEmpty>

          {debounced.length > 0 && (
            <CommandGroup
              heading={
                <span className="flex items-center justify-between gap-2">
                  {t("palette.stocks")}
                  {search.data && <FreshnessBadge freshness={search.data.freshness} asOf={search.data.asOf} source={search.data.source} />}
                </span>
              }
            >
              {search.isError && (
                <CommandItem disabled value={`${debounced} error`}>
                  {t("palette.searchError")}
                </CommandItem>
              )}
              {search.data?.data.slice(0, 8).map((stock) => (
                <CommandItem key={stock.symbol} value={`${stock.symbol} ${stock.companyName}`} onSelect={() => go(stockHref(stock.symbol))} data-testid={`palette-stock-${stock.symbol}`}>
                  <LineChart />
                  <TickerLogo symbol={stock.symbol} size="sm" />
                  <span className="ticker w-14 shrink-0">{stock.symbol}</span>
                  <span className="truncate text-muted-foreground">{stock.companyName}</span>
                  <CornerDownLeft className="ml-auto opacity-0 group-data-[selected=true]:opacity-60" />
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {tabsSymbol && (
            <CommandGroup heading={t("palette.tabsFor", { symbol: tabsSymbol })}>
              {STOCK_TABS.map((tab) => (
                <CommandItem key={tab} value={`${tabsSymbol} ${t(`stockTabs.${tab}`)} ${tab}`} onSelect={() => go(stockHref(tabsSymbol, tab))}>
                  <span className="ticker w-14 shrink-0 text-muted-foreground">{tabsSymbol}</span>
                  {t(`stockTabs.${tab}`)}
                </CommandItem>
              ))}
              <CommandItem value={`${tabsSymbol} ${t("research.link")} research`} onSelect={() => go(`/research/${tabsSymbol}`)} data-testid={`palette-research-${tabsSymbol}`}>
                <span className="ticker w-14 shrink-0 text-muted-foreground">{tabsSymbol}</span>
                {t("research.link")}
              </CommandItem>
            </CommandGroup>
          )}

          <CommandSeparator />
          <CommandGroup heading={t("palette.pages")}>
            {ALL_PAGES.map((page) => (
              <CommandItem key={page.key} value={`${t(`nav.${page.key}`)} ${page.key}`} onSelect={() => go(page.href)} data-testid={`palette-page-${page.key}`}>
                <page.icon />
                {t(`nav.${page.key}`)}
              </CommandItem>
            ))}
          </CommandGroup>

          <CommandGroup heading={t("palette.savedScreens")}>
            {viewer.kind !== "user" ? (
              <CommandItem disabled value="saved screens sign in">
                <Filter />
                {t("palette.savedScreensSignIn")}
              </CommandItem>
            ) : savedScreens.isError ? (
              <CommandItem disabled value="saved screens error">{t("palette.savedScreensError")}</CommandItem>
            ) : savedScreens.isPending ? (
              <CommandItem disabled value="saved screens loading">{t("palette.savedScreensLoading")}</CommandItem>
            ) : savedScreens.data?.length === 0 ? (
              <CommandItem disabled value="saved screens empty">
                <Filter />
                {t("palette.savedScreensEmpty")}
              </CommandItem>
            ) : (
              savedScreens.data?.slice(0, 10).map((screen) => (
                <CommandItem key={screen.id} value={`screen ${screen.name}`} onSelect={() => go(`/discover/screener?screen=${screen.id}`)}>
                  <FileText />
                  {screen.name}
                </CommandItem>
              ))
            )}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
