import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { RotationView } from "./rotation-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/rotation">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("rotation") };
}

export default async function RotationPage({ params }: PageProps<"/[locale]/discover/rotation">) {
  setRequestLocale((await params).locale);
  return <RotationView />;
}
