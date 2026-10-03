import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/components/auth/auth-form";
import { resolveAuthConfig } from "@/server/config/auth";

export async function generateMetadata({ params }: PageProps<"/[locale]/signup">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("signUpTitle") };
}

export default async function Page({ params, searchParams }: PageProps<"/[locale]/signup">) {
  setRequestLocale((await params).locale);
  const query = await searchParams;
  const next = typeof query.next === "string" ? query.next : undefined;
  return <AuthForm kind="signup" mode={resolveAuthConfig(process.env).mode} next={next} callbackError={query.error === "auth"} />;
}
