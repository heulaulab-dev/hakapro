import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Plus_Jakarta_Sans } from "next/font/google";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { SHARE_IMAGE_ALT, SHARE_IMAGE_SIZE } from "@/components/brand/share-image";
import { FixtureBanner } from "@/components/feedback/fixture-banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routing } from "@/i18n/routing";
import { BRAND_NAME } from "@/lib/brand";
import { DENSITY_COOKIE, parseDensity, parseTheme, THEME_COLOR, THEME_COOKIE } from "@/lib/preferences";
import { isIndexable, resolveSiteOrigin } from "@/server/config/auth";
import "../globals.css";

// Brand typeface (logo guidelines §06): headings and brand surfaces only. Body and data stay on Geist.
const brandFont = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], display: "swap", variable: "--font-plus-jakarta-sans" });

const CLIENT_NAMESPACES = ["app", "freshness", "locale", "theme", "density", "nav", "stockTabs", "header", "palette", "account", "dataState", "table", "chart", "metrics", "criteria", "strategy", "insiders", "broker", "filters", "drawer", "dev", "disclaimer", "home", "strategies", "overview", "auth", "watchlist", "flow", "financials", "screener", "movers", "news", "ownershipChanges", "stockChart", "stockInsiders", "insiderHolders", "stockHistory", "stockOwnership", "errors", "alerts", "analysis", "lastPrice"] as const;

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  const origin = resolveSiteOrigin(process.env);
  const indexable = isIndexable(process.env);
  return {
    // Share images and alternate links resolve against the environment's own origin, not the build's.
    ...(origin ? { metadataBase: new URL(origin) } : {}),
    title: { default: BRAND_NAME, template: `%s · ${BRAND_NAME}` },
    applicationName: BRAND_NAME,
    description: `${t("tagline")} ${t("summary")}`,
    // File-based share images resolve against the parent segment's metadataBase, and this is the root
    // layout, so Next would fall back to localhost. Point at the same image routes with absolute URLs.
    ...(origin ? shareImages(origin, locale) : {}),
    robots: { index: indexable, follow: indexable },
  };
}

function shareImages(origin: string, locale: string): Pick<Metadata, "openGraph" | "twitter"> {
  const image = (route: string) => ({ url: `${origin}/${locale}/${route}`, ...SHARE_IMAGE_SIZE, alt: SHARE_IMAGE_ALT, type: "image/png" });
  return {
    openGraph: { siteName: BRAND_NAME, type: "website", images: [image("opengraph-image")] },
    twitter: { card: "summary_large_image", images: [image("twitter-image")] },
  };
}

/** Follows the cookie theme (the app ignores the OS scheme), so the browser bar matches the page. */
export async function generateViewport(): Promise<Viewport> {
  const store = await cookies();
  return { themeColor: THEME_COLOR[parseTheme(store.get(THEME_COOKIE)?.value)] };
}

export default async function LocaleLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const store = await cookies();
  const theme = parseTheme(store.get(THEME_COOKIE)?.value);
  const density = parseDensity(store.get(DENSITY_COOKIE)?.value);
  // Only namespaces used by client components are serialized to the browser.
  const messages = await getMessages();
  const clientMessages = Object.fromEntries(CLIENT_NAMESPACES.map((namespace) => [namespace, messages[namespace]]));

  return (
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable} ${brandFont.variable} ${theme} h-full antialiased`} data-density={density}>
      <body className="flex h-dvh flex-col overflow-hidden">
        <NextIntlClientProvider messages={clientMessages}>
          <TooltipProvider delayDuration={150}>
            <FixtureBanner />
            {children}
          </TooltipProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
