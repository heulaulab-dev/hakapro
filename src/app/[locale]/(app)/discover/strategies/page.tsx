import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { StrategiesView } from "./strategies-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/strategies">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("strategies") };
}

export default async function StrategiesPage({ params }: PageProps<"/[locale]/discover/strategies">) {
  setRequestLocale((await params).locale);
  return <StrategiesView />;
}
