import { getTranslations, setRequestLocale } from "next-intl/server";
import { PagePlaceholder } from "@/components/layout/page-placeholder";

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  setRequestLocale((await params).locale);
  const t = await getTranslations("home");
  return <PagePlaceholder title={t("title")} />;
}
