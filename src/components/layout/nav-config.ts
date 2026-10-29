import {
  Activity, ArrowUpDown, Bell, Bookmark, Briefcase, Compass, House, Info, Landmark, LayoutGrid, ListChecks, Newspaper,
  SlidersHorizontal, type Icon, Network, BookOpen, Building2, Radar, Coins, TrendingUp, Zap, Waves, ChartColumn,
} from "@/components/kit/icons";

export type NavKey =
  | "home" | "discover" | "screener" | "strategies" | "movers" | "heatmap" | "groups" | "radar" | "ownership" | "stealth"
  | "macro" | "rotation" | "intelligence" | "compare" | "feed" | "watchlist" | "portfolio" | "news" | "alerts" | "methodology" | "about"
  // Module groups (BDMFlow-style terminal menu).
  | "pulse" | "bandar" | "scalp" | "whale" | "investor";
export type NavItem = { key: NavKey; href: string; icon: Icon; children?: NavItem[] };

// Leaf destinations, defined once and arranged into module groups below.
const PAGES = {
  home: { key: "home", href: "/dashboard", icon: House },
  movers: { key: "movers", href: "/discover/movers", icon: ArrowUpDown },
  heatmap: { key: "heatmap", href: "/discover/heatmap", icon: LayoutGrid },
  macro: { key: "macro", href: "/discover/macro", icon: Coins },
  rotation: { key: "rotation", href: "/discover/rotation", icon: Compass },
  intelligence: { key: "intelligence", href: "/discover/intelligence", icon: Radar },
  compare: { key: "compare", href: "/discover/compare", icon: ChartColumn },
  feed: { key: "feed", href: "/discover/feed", icon: Activity },
  news: { key: "news", href: "/news", icon: Newspaper },
  radar: { key: "radar", href: "/discover/radar", icon: Radar },
  groups: { key: "groups", href: "/discover/groups", icon: Network },
  strategies: { key: "strategies", href: "/discover/strategies", icon: ListChecks },
  screener: { key: "screener", href: "/discover/screener", icon: SlidersHorizontal },
  ownership: { key: "ownership", href: "/discover/ownership", icon: Landmark },
  stealth: { key: "stealth", href: "/discover/stealth", icon: Building2 },
  watchlist: { key: "watchlist", href: "/watchlist", icon: Bookmark },
  portfolio: { key: "portfolio", href: "/portfolio", icon: Briefcase },
  alerts: { key: "alerts", href: "/alerts", icon: Bell },
} satisfies Record<string, NavItem>;

/**
 * The terminal menu, grouped into modules (BDMFlow-style): a quick-access Home, then named groups of related tools.
 * The desktop sidebar renders each group with a label; the mobile "all modules" sheet renders the same groups as a
 * grid. Every leaf must be reachable here or in SECONDARY so Cmd+K (ALL_PAGES) can find it.
 */
export const NAV: NavItem[] = [
  PAGES.home,
  { key: "pulse", href: PAGES.movers.href, icon: Activity, children: [PAGES.movers, PAGES.heatmap, PAGES.feed, PAGES.rotation, PAGES.macro, PAGES.intelligence, PAGES.compare, PAGES.news] },
  { key: "bandar", href: PAGES.radar.href, icon: TrendingUp, children: [PAGES.radar, PAGES.groups, PAGES.strategies] },
  { key: "scalp", href: PAGES.screener.href, icon: Zap, children: [PAGES.screener] },
  { key: "whale", href: PAGES.ownership.href, icon: Waves, children: [PAGES.ownership, PAGES.stealth] },
  { key: "investor", href: PAGES.watchlist.href, icon: Briefcase, children: [PAGES.watchlist, PAGES.portfolio, PAGES.alerts] },
];

/** The ordered module groups (every NAV item that has children). */
export const MODULE_GROUPS: NavItem[] = NAV.filter((item) => item.children);

/** Secondary destinations: not in a module group, reachable from Cmd+K, the account menu and mobile More. */
export const SECONDARY: NavItem[] = [{ key: "methodology", href: "/methodology", icon: BookOpen }, { key: "about", href: "/", icon: Info }];

/** Every page reachable from Cmd+K (leaf pages only; group headers are not destinations). */
export const ALL_PAGES: NavItem[] = [...NAV.flatMap((item) => (item.children ? item.children : [item])), ...SECONDARY];

/** The Discover glyph, still used as the command-palette group label. */
export const DISCOVER_ICON = Compass;

export const STOCK_TABS = ["overview", "chart", "flow", "running", "analysis", "financials", "ownership", "insiders", "history"] as const;
export type StockTab = (typeof STOCK_TABS)[number];

export function stockHref(symbol: string, tab: StockTab = "overview"): string {
  return tab === "overview" ? `/stock/${symbol}` : `/stock/${symbol}/${tab}`;
}

/** "/discover/screener" is active for "/discover/screener?x=1"; "/" only matches exactly. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
