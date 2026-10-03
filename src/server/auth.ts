import "server-only";
import { createClient } from "@/lib/supabase/server";
import { decideAccess, resolveAuthConfig, type AccessDecision } from "@/server/config/auth";

/**
 * Access check for every protected server entry point (route handlers now, server components
 * that read market data later). Fails closed: missing config is "not_configured", never "allow".
 */
export async function checkAccess(): Promise<AccessDecision> {
  return decideAccess(resolveAuthConfig(process.env), async () => {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    return !error && Boolean(data?.claims?.sub);
  });
}
