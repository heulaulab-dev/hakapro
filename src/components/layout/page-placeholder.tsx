import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

/** Temporary stand-in for screens built in later steps; replaced by SectionHeader/EmptyState (Step 6). */
export async function PagePlaceholder({ title, level = 1, children }: { title: ReactNode; level?: 1 | 2; children?: ReactNode }) {
  const Heading = level === 1 ? "h1" : "h2";
  const t = await getTranslations("placeholder");
  return (
    <div className="flex flex-col gap-section p-4 md:p-6">
      <Heading data-testid="page-title" className="text-lg font-semibold">{title}</Heading>
      {children}
      <p className="text-sm text-muted-foreground">{t("comingSoon")}</p>
    </div>
  );
}
