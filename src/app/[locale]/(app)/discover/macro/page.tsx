import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MacroView } from "./macro-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/macro">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("macro") };
}

export default async function MacroPage({ params }: PageProps<"/[locale]/discover/macro">) {
  setRequestLocale((await params).locale);
  return <MacroView />;
}
