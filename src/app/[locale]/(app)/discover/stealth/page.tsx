import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { isAdmin } from "@/server/admin";
import { StealthView } from "./stealth-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/stealth">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("stealth") };
}

export default async function StealthPage({ params }: PageProps<"/[locale]/discover/stealth">) {
  setRequestLocale((await params).locale);
  return <StealthView canUpload={await isAdmin()} />;
}
