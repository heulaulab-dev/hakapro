import createMiddleware from "next-intl/middleware";
import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/proxy";

const handleI18n = createMiddleware(routing);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // Route handlers are not localized; they only need the session refresh.
  if (pathname.startsWith("/api/") || pathname.startsWith("/auth/")) return updateSession(request);
  const response = handleI18n(request);
  // Locale redirects (e.g. "/" → "/id") go out as-is; the session is refreshed on the follow-up request.
  if (response.headers.has("location")) return response;
  return updateSession(request, response);
}

export const config = {
  // Metadata routes (manifest, OG/Twitter images) are served at the root, outside the locale prefix.
  matcher: ["/((?!_next|_vercel|favicon.ico|robots.txt|manifest.webmanifest|opengraph-image|twitter-image|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt)$).*)"],
};
