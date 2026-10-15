import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/components/auth/auth-form";
import { resolveAuthConfig } from "@/server/config/auth";

export async function generateMetadata({ params }: PageProps<"/[locale]/login">): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale, namespace: "auth" });
  return { title: t("signInTitle") };
}

export default async function Page({ params, searchParams }: PageProps<"/[locale]/login">) {
  setRequestLocale((await params).locale);
  const query = await searchParams;
  const next = typeof query.next === "string" ? query.next : undefined;
  const config = resolveAuthConfig(process.env);
  return <AuthForm kind="login" mode={config.mode} googleEnabled={config.mode === "better_auth" && Boolean(config.google)} passwordEnabled={config.mode === "better_auth" && Boolean(config.smtp)} next={next} callbackError={query.error === "auth"} resetSuccess={query.reset === "success"} />;
}
