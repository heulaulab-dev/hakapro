import { setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/components/auth/auth-form";
import { resolveAuthConfig } from "@/server/config/auth";

export default async function Page({ params, searchParams }: PageProps<"/[locale]/reset-password">) {
  setRequestLocale((await params).locale);
  const query = await searchParams;
  const next = typeof query.next === "string" ? query.next : undefined;
  return <AuthForm kind="reset" mode={resolveAuthConfig(process.env).mode} next={next} callbackError={query.error === "auth"} />;
}
