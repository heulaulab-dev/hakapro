import "server-only";
import { getAuthSession } from "@/server/auth";
import { resolveAuthConfig } from "@/server/config/auth";

export type Viewer =
  | { kind: "bypass" }
  | { kind: "unconfigured" }
  | { kind: "anonymous" }
  | { kind: "user"; id: string; email: string | null };

export async function getViewer(): Promise<Viewer> {
  const config = resolveAuthConfig(process.env);
  if (config.mode === "bypass") return { kind: "bypass" };
  if (config.mode === "unconfigured") return { kind: "unconfigured" };
  try {
    const session = await getAuthSession();
    return session ? { kind: "user", id: session.user.id, email: session.user.email } : { kind: "anonymous" };
  } catch {
    return { kind: "anonymous" };
  }
}
