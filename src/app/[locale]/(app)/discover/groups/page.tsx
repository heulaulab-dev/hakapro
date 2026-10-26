import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { GroupsView } from "./groups-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/discover/groups">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "nav" });
  return { title: t("groups") };
}

export default async function GroupsPage({ params }: PageProps<"/[locale]/discover/groups">) {
  setRequestLocale((await params).locale);
  return <GroupsView />;
}
