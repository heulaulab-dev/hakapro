import { resolveAuthConfig } from "@/server/config/auth";

async function handle(request: Request) {
  if (resolveAuthConfig(process.env).mode !== "better_auth") {
    return Response.json({ error: "AUTH_NOT_CONFIGURED" }, { status: 503 });
  }
  const { auth } = await import("@/server/better-auth");
  return auth.handler(request);
}

export const GET = handle;
export const POST = handle;
