import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NewsView } from "./news-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/news">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("news") };
}

export default async function NewsPage({ params }: PageProps<"/[locale]/news">) {
  setRequestLocale((await params).locale);
  return <NewsView />;
}
