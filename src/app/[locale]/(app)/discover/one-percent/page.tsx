import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { OnePercentView } from "./one-percent-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/one-percent">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("onePercent") };
}

export default async function OnePercentPage({ params }: PageProps<"/[locale]/discover/one-percent">) {
  setRequestLocale((await params).locale);
  return <OnePercentView />;
}
