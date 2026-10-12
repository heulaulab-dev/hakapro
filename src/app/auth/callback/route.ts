import { NextResponse } from "next/server";
import { routing } from "@/i18n/routing";

/** Retired Supabase callback. New OAuth callbacks are handled by Better Auth. */
export function GET(request: Request) {
  const next = new URL(request.url).searchParams.get("next");
  const locale = (routing.locales as readonly string[]).find((candidate) => next?.startsWith(`/${candidate}/`)) ?? routing.defaultLocale;
  return NextResponse.redirect(new URL(`/${locale}/login?error=auth`, request.url));
}
