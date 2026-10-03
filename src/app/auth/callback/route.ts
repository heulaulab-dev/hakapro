import { NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

/** Supabase email-confirmation / OAuth / password-recovery landing. Only safe app paths are followed. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const nextParam = url.searchParams.get("next");
  const locale = (routing.locales as readonly string[]).find((candidate) => nextParam?.startsWith(`/${candidate}`)) ?? routing.defaultLocale;
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNextPath(nextParam, locale, routing.locales), url.origin));
  }
  return NextResponse.redirect(new URL(`/${locale}/login?error=auth`, url.origin));
}
