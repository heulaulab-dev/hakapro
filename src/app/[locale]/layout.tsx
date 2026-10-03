import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { FixtureBanner } from "@/components/feedback/fixture-banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { routing } from "@/i18n/routing";
import { DENSITY_COOKIE, parseDensity, parseTheme, THEME_COOKIE } from "@/lib/preferences";
import "../globals.css";

const CLIENT_NAMESPACES = ["freshness", "locale", "theme", "density", "nav", "stockTabs", "header", "palette", "account", "dataState", "table", "chart", "metrics", "criteria", "strategy", "insiders", "broker", "filters", "drawer", "dev", "disclaimer", "home", "strategies", "overview", "auth", "watchlist", "flow", "financials"] as const;

export async function generateMetadata({ params }: LayoutProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "app" });
  return { title: t("name"), description: t("tagline") };
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
    <html lang={locale} className={`${GeistSans.variable} ${GeistMono.variable} ${theme} h-full antialiased`} data-density={density}>
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
