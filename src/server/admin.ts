import "server-only";
import { getViewer } from "@/server/viewer";

/** HAKAPRO_ADMIN_EMAILS: comma-separated sign-in emails allowed to run admin tasks (ownership uploads). */
export function adminEmails(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set((env.HAKAPRO_ADMIN_EMAILS ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

/** A signed-in user on the allowlist. The dev auth bypass (never allowed in production) counts as admin. */
export async function isAdmin(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const viewer = await getViewer();
  if (viewer.kind === "bypass") return true;
  return viewer.kind === "user" && viewer.email !== null && adminEmails(env).has(viewer.email.toLowerCase());
}

/** The Data Engine's admin API: its private URL (MARKET_API_URL) and ENGINE_ADMIN_TOKEN. Null when either is missing. */
export function engineAdmin(env: Record<string, string | undefined> = process.env): { baseUrl: string; token: string } | null {
  const baseUrl = env.MARKET_API_URL?.trim().replace(/\/+$/, "");
  const token = env.ENGINE_ADMIN_TOKEN?.trim();
  return baseUrl && token ? { baseUrl, token } : null;
}
