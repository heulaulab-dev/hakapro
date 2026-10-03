// Ported from heulatrade lib/supabase/proxy.ts. Locale handling is merged in Step 4.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "./database.types";
import { resolveAuthConfig } from "@/server/config/auth";

const PUBLIC_PREFIXES = ["/login", "/signup", "/forgot-password", "/reset-password", "/auth/callback"];

export async function updateSession(request: NextRequest) {
  const auth = resolveAuthConfig(process.env);
  // Bypass (dev only) and unconfigured dev skip the session refresh; protected routes still
  // enforce access themselves via checkAccess(), which refuses the unconfigured case.
  if (auth.mode !== "supabase") return NextResponse.next({ request });
  const env = auth;
  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(env.url, env.key, {
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(items) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getClaims();
  const isAuthenticated = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;
  // API routes answer 401 JSON themselves instead of being redirected to an HTML login page.
  const isPublic = pathname === "/" || pathname.startsWith("/api/") || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  if (!isAuthenticated && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (isAuthenticated && (pathname === "/login" || pathname === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return response;
}
