import "server-only";
import { headers } from "next/headers";
import { decideAccess, resolveAuthConfig, type AccessDecision } from "@/server/config/auth";
import type { AuthSession } from "@/server/better-auth";

/** The server session is authoritative; a cookie's presence alone never grants access. */
export async function getAuthSession(): Promise<AuthSession | null> {
  if (resolveAuthConfig(process.env).mode !== "better_auth") return null;
  const { auth } = await import("@/server/better-auth");
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUser(): Promise<{ id: string; email: string }> {
  const session = await getAuthSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return { id: session.user.id, email: session.user.email };
}

export async function checkAccess(): Promise<AccessDecision> {
  return decideAccess(resolveAuthConfig(process.env), async () => Boolean(await getAuthSession()));
}
