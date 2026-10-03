import { SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default async function LocaleNotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="flex flex-1 items-center justify-center p-6" data-testid="not-found">
      <EmptyState icon={<SearchX />} title={t("notFoundTitle")} description={t("notFoundDescription")} action={<Button size="sm" variant="outline" asChild><Link href="/">{t("home")}</Link></Button>} />
    </main>
  );
}
