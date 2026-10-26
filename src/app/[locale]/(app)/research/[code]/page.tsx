import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { isAiEnabled } from "@/server/config/ai";
import { symbolSchema } from "@/server/schemas/inputs";
import { ResearchView } from "./research-view";

export async function generateMetadata({ params }: PageProps<"/[locale]/research/[code]">): Promise<Metadata> {
  const { locale, code } = await params;
  const t = await getTranslations({ locale, namespace: "research" });
  return { title: t("metaTitle", { code: code.toUpperCase() }) };
}

export default async function ResearchPage({ params }: PageProps<"/[locale]/research/[code]">) {
  const { locale, code: raw } = await params;
  setRequestLocale(locale);
  const parsed = symbolSchema.safeParse(raw);
  if (!parsed.success) notFound();
  // Canonical tickers are upper-case, as on the stock pages: /id/research/bbca → /id/research/BBCA.
  if (parsed.data !== raw) redirect(`/${locale}/research/${parsed.data}`);
  // The AI flag and key are runtime secrets: read them at request time, and pass only a boolean to the client.
  await connection();
  return <ResearchView code={parsed.data} aiEnabled={isAiEnabled()} />;
}
