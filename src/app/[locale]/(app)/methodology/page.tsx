import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MethodologyView } from "./methodology-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/methodology">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("methodology") };
}

export default async function MethodologyPage({ params }: PageProps<"/[locale]/methodology">) {
  setRequestLocale((await params).locale);
  return <MethodologyView />;
}
