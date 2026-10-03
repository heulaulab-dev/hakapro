import "server-only";
import { createClient } from "@/lib/supabase/server";
import { resolveAuthConfig } from "@/server/config/auth";

export type Viewer =
  | { kind: "bypass" }
  | { kind: "unconfigured" }
  | { kind: "anonymous" }
  | { kind: "user"; id: string; email: string | null };

/** Who is looking at the page, for display only. Access control stays in checkAccess(). */
export async function getViewer(): Promise<Viewer> {
  const config = resolveAuthConfig(process.env);
  if (config.mode === "bypass") return { kind: "bypass" };
  if (config.mode === "unconfigured") return { kind: "unconfigured" };
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    const claims = data?.claims;
    if (!claims?.sub) return { kind: "anonymous" };
    return { kind: "user", id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
  } catch {
    return { kind: "anonymous" };
  }
}
