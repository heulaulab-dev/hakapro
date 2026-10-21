import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { isAdmin } from "@/server/admin";
import { OwnershipUploadView } from "./upload-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/admin/ownership">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "ownershipUpload" });
  return { title: t("title"), robots: { index: false } };
}

/** Admin only: everyone else gets the ordinary 404, so the page's existence isn't advertised. */
export default async function OwnershipUploadPage({ params }: PageProps<"/[locale]/admin/ownership">) {
  setRequestLocale((await params).locale);
  if (!(await isAdmin())) notFound();
  return <OwnershipUploadView />;
}
