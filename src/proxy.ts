import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { resolveAuthConfig } from "@/server/config/auth";

const handleI18n = createMiddleware(routing);
const PUBLIC_PATHS = ["/login", "/signup", "/forgot-password", "/reset-password", "/dev"];
const LOCALE_PREFIX = new RegExp(`^/(${routing.locales.join("|")})(?=/|$)`);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Route handlers answer with JSON or handle their own callback.
  if (pathname.startsWith("/api/")) return NextResponse.next();
  const response = handleI18n(request);
  // Follow locale redirects before inspecting a localized page.
  if (response.headers.has("location")) return response;
  const config = resolveAuthConfig(process.env);
  if (config.mode !== "better_auth") return response;
  const match = LOCALE_PREFIX.exec(pathname);
  const locale = match?.[1] ?? routing.defaultLocale;
  const path = pathname.slice(match?.[0].length ?? 0) || "/";
  const isPublic = path === "/" || PUBLIC_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  const { auth } = await import("@/server/better-auth");
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session && !isPublic) {
    const login = new URL(`/${locale}/login`, request.url);
    login.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(login);
  }
  if (session && (path === "/login" || path === "/signup")) {
    return NextResponse.redirect(new URL(`/${locale}/dashboard`, request.url));
  }
  return response;
}

export const config = {
  // Metadata routes (manifest, OG/Twitter images) are served at the root, outside the locale prefix.
  matcher: ["/((?!_next|_vercel|favicon.ico|robots.txt|manifest.webmanifest|opengraph-image|twitter-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)"],
};
