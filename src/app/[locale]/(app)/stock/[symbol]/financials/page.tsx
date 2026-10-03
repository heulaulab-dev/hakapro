import { getTranslations, setRequestLocale } from "next-intl/server";
import { PagePlaceholder } from "@/components/layout/page-placeholder";

export default async function Page({ params }: PageProps<"/[locale]/stock/[symbol]/financials">) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("stockTabs");
  return <PagePlaceholder level={2} title={t("financials")} />;
}
