import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { CompareView } from "./compare-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/compare">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "comparison" });
  return { title: t("title") };
}

export default async function ComparePage({ params }: PageProps<"/[locale]/discover/compare">) {
  setRequestLocale((await params).locale);
  return <CompareView />;
}
