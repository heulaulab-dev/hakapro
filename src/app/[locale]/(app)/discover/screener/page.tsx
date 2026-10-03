import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getViewer } from "@/server/viewer";
import { ScreenerView } from "./screener-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/screener">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("screener") };
}

export default async function ScreenerPage({ params }: PageProps<"/[locale]/discover/screener">) {
  setRequestLocale((await params).locale);
  return <ScreenerView viewer={await getViewer()} />;
}
