// Ported from heulatrade lib/supabase/proxy.ts; composed with next-intl routing in src/proxy.ts.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { resolveAuthConfig } from "@/server/config/auth";
import type { Database } from "./database.types";

const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback", "/dev"];
const LOCALE_PREFIX = new RegExp(`^/(${routing.locales.join("|")})(?=/|$)`);

/** Path without its locale prefix: "/id/stock/BBCA" → "/stock/BBCA". */
export function stripLocale(pathname: string): { locale: string; path: string } {
  const match = LOCALE_PREFIX.exec(pathname);
  return { locale: match?.[1] ?? routing.defaultLocale, path: pathname.slice(match?.[0].length ?? 0) || "/" };
}

/**
 * Refreshes the Supabase session onto `response` (the next-intl response, so locale rewrites are
 * kept) and redirects anonymous users away from protected pages. Bypass and unconfigured dev skip
 * the refresh; protected data routes still refuse the unconfigured case via checkAccess().
 */
export async function updateSession(request: NextRequest, response: NextResponse = NextResponse.next({ request })) {
  const auth = resolveAuthConfig(process.env);
  if (auth.mode !== "supabase") return response;
  const supabase = createServerClient<Database>(auth.url, auth.key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(items) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;
  // API routes answer 401 JSON themselves instead of being redirected to an HTML login page.
  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) return response;
  const { locale, path } = stripLocale(pathname);
  const isPublic = path === "/" || PUBLIC_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  if (!isAuthenticated && !isPublic) {
    const login = new URL(`/${locale}/login`, request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  if (isAuthenticated && (path === "/login" || path === "/signup")) return NextResponse.redirect(new URL(`/${locale}`, request.url));
  return response;
}
