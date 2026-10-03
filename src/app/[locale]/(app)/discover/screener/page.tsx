import { getTranslations, setRequestLocale } from "next-intl/server";
import { PagePlaceholder } from "@/components/layout/page-placeholder";

export default async function Page({ params }: PageProps<"/[locale]/discover/screener">) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("nav");
  return <PagePlaceholder title={t("screener")} />;
}
