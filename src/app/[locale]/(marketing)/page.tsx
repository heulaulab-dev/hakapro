import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { LandingPage } from "@/components/landing/landing-page";
import { parseTheme, THEME_COOKIE } from "@/lib/preferences";
import { getViewer } from "@/server/viewer";

export async function generateMetadata({ params }: PageProps<"/[locale]">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "landing.meta" });
  return { title: { absolute: t("title") }, description: t("description"), alternates: { languages: { id: "/id", en: "/en" } } };
}

export default async function LandingRoute({ params }: PageProps<"/[locale]">) {
  setRequestLocale((await params).locale);
  const [viewer, store] = await Promise.all([getViewer(), cookies()]);
  return <LandingPage viewer={viewer} theme={parseTheme(store.get(THEME_COOKIE)?.value)} />;
}
