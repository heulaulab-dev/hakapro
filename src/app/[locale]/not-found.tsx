import { SearchX } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Logo } from "@/components/brand/logo";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default async function LocaleNotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6" data-testid="not-found">
      <Link href="/" data-testid="not-found-brand"><Logo variant="horizontal" height={36} priority /></Link>
      <EmptyState icon={<SearchX />} title={t("notFoundTitle")} description={t("notFoundDescription")} action={<Button size="sm" variant="outline" asChild><Link href="/dashboard">{t("home")}</Link></Button>} />
    </main>
  );
}
