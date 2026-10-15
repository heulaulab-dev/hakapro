import { setRequestLocale } from "next-intl/server";
import { AuthForm } from "@/components/auth/auth-form";
import { resolveAuthConfig } from "@/server/config/auth";

export default async function Page({ params, searchParams }: PageProps<"/[locale]/forgot-password">) {
  setRequestLocale((await params).locale);
  const query = await searchParams;
  const next = typeof query.next === "string" ? query.next : undefined;
  const config = resolveAuthConfig(process.env);
  return <AuthForm kind="forgot" mode={config.mode} googleEnabled={config.mode === "better_auth" && Boolean(config.google)} passwordEnabled={config.mode === "better_auth" && Boolean(config.smtp)} next={next} callbackError={query.error === "auth"} />;
}
