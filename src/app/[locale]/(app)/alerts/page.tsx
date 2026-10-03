import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getViewer } from "@/server/viewer";
import { AlertsView } from "./alerts-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/alerts">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "alerts" });
  return { title: t("title") };
}

export default async function AlertsPage({ params }: PageProps<"/[locale]/alerts">) {
  setRequestLocale((await params).locale);
  return <AlertsView viewer={await getViewer()} />;
}
