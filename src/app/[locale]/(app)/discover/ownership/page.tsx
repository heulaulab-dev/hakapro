import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { isAdmin } from "@/server/admin";
import { getViewer } from "@/server/viewer";
import { OwnershipView } from "./ownership-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/ownership">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("ownership") };
}

export default async function OwnershipChangesPage({ params }: PageProps<"/[locale]/discover/ownership">) {
  setRequestLocale((await params).locale);
  return <OwnershipView viewer={await getViewer()} canUpload={await isAdmin()} />;
}
