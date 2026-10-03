"use server";

import { redirect } from "next/navigation";
import { routing } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/server";
import { resolveAuthConfig } from "@/server/config/auth";

export async function signOut(locale: string): Promise<never> {
  if (resolveAuthConfig(process.env).mode === "supabase") {
    const supabase = await createClient();
    await supabase.auth.signOut();
  }
  const safeLocale = (routing.locales as readonly string[]).includes(locale) ? locale : routing.defaultLocale;
  redirect(`/${safeLocale}`);
}
