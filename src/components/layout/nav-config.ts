import { ArrowUpDown, Bell, Bookmark, Compass, House, Landmark, ListChecks, Newspaper, SlidersHorizontal, type LucideIcon } from "lucide-react";

export type NavKey = "home" | "discover" | "screener" | "strategies" | "movers" | "ownership" | "watchlist" | "news" | "alerts";
export type NavItem = { key: NavKey; href: string; icon: LucideIcon; children?: NavItem[] };

/** The four primary destinations. Stock pages are reached via search, Cmd+K or lists, never the nav. */
export const NAV: NavItem[] = [
  { key: "home", href: "/", icon: House },
  {
    key: "discover",
    href: "/discover/strategies",
    icon: Compass,
    children: [
      { key: "screener", href: "/discover/screener", icon: SlidersHorizontal },
      { key: "strategies", href: "/discover/strategies", icon: ListChecks },
      { key: "movers", href: "/discover/movers", icon: ArrowUpDown },
      { key: "ownership", href: "/discover/ownership", icon: Landmark },
    ],
  },
  { key: "watchlist", href: "/watchlist", icon: Bookmark },
  { key: "news", href: "/news", icon: Newspaper },
];

/** Secondary destinations: not in the 4-item sidebar, reachable from Cmd+K, the account menu and mobile More. */
export const SECONDARY: NavItem[] = [{ key: "alerts", href: "/alerts", icon: Bell }];

/** Every page reachable from Cmd+K. */
export const ALL_PAGES: NavItem[] = [...NAV.flatMap((item) => (item.children ? item.children : [item])), ...SECONDARY];

export const STOCK_TABS = ["overview", "chart", "flow", "financials", "ownership", "insiders", "history"] as const;
export type StockTab = (typeof STOCK_TABS)[number];

export function stockHref(symbol: string, tab: StockTab = "overview"): string {
  return tab === "overview" ? `/stock/${symbol}` : `/stock/${symbol}/${tab}`;
}

/** "/discover/screener" is active for "/discover/screener?x=1"; "/" only matches exactly. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
