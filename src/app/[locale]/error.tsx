"use client";

import { AlertTriangle } from "@/components/kit/icons";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { Logo } from "@/components/brand/logo";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  useEffect(() => {
    // Only the digest is logged client-side; details stay in server logs.
    console.error(JSON.stringify({ level: "error", event: "page_error", digest: error.digest ?? null }));
  }, [error.digest]);
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6">
      <Link href="/"><Logo variant="horizontal" height={36} priority /></Link>
      <EmptyState icon={<AlertTriangle />} title={t("title")} description={<>{t("description")}{error.digest && <span className="ticker mt-1 block">{t("reference", { digest: error.digest })}</span>}</>}
        action={<div className="flex gap-2"><Button size="sm" onClick={reset}>{t("retry")}</Button><Button size="sm" variant="outline" asChild><Link href="/dashboard">{t("home")}</Link></Button></div>} />
    </main>
  );
}
