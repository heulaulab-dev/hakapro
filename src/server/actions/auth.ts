"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { users, verifications } from "@/db/schema";
import { routing } from "@/i18n/routing";
import { resolveAuthConfig } from "@/server/config/auth";

export async function signOut(locale: string): Promise<never> {
  if (resolveAuthConfig(process.env).mode === "better_auth") {
    const { auth } = await import("@/server/better-auth");
    await auth.api.signOut({ headers: await headers() });
  }
  const safeLocale = (routing.locales as readonly string[]).includes(locale) ? locale : routing.defaultLocale;
  redirect(`/${safeLocale}`);
}

/** Reset the credential and create a session, retaining the dashboard destination. */
export async function completePasswordReset(token: string, newPassword: string): Promise<{ ok: boolean; signedIn: boolean }> {
  if (!token || newPassword.length < 8 || resolveAuthConfig(process.env).mode !== "better_auth") return { ok: false, signedIn: false };
  const { db } = await import("@/server/db");
  const [verification] = await db.select({ userId: verifications.value, expiresAt: verifications.expiresAt })
    .from(verifications).where(eq(verifications.identifier, `reset-password:${token}`)).limit(1);
  if (!verification || verification.expiresAt <= new Date()) return { ok: false, signedIn: false };
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, verification.userId)).limit(1);
  if (!user) return { ok: false, signedIn: false };
  const { auth } = await import("@/server/better-auth");
  try {
    await auth.api.resetPassword({ body: { token, newPassword }, headers: await headers() });
  } catch {
    return { ok: false, signedIn: false };
  }
  try {
    await auth.api.signInEmail({ body: { email: user.email, password: newPassword }, headers: await headers() });
    return { ok: true, signedIn: true };
  } catch {
    return { ok: true, signedIn: false };
  }
}
