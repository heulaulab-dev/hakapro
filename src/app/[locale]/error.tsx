"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
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
    <main className="flex flex-1 items-center justify-center p-6">
      <EmptyState icon={<AlertTriangle />} title={t("title")} description={<>{t("description")}{error.digest && <span className="ticker mt-1 block">{t("reference", { digest: error.digest })}</span>}</>}
        action={<div className="flex gap-2"><Button size="sm" onClick={reset}>{t("retry")}</Button><Button size="sm" variant="outline" asChild><Link href="/">{t("home")}</Link></Button></div>} />
    </main>
  );
}
