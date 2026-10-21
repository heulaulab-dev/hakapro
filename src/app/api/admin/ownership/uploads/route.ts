import { NextResponse } from "next/server";
import { z } from "zod";
import { engineAdmin, isAdmin } from "@/server/admin";
import { logError, logWarn } from "@/server/log";
import { ownershipMonthSchema, ownershipUploadSchema } from "@/server/schemas/ownership";

export const runtime = "nodejs";

/** The engine's own cap (ENGINE_OWNERSHIP_MAX_UPLOAD_MB default); the engine enforces its configured value too. */
const MAX_BYTES = 20 * 1024 * 1024;
const FORMATS = /\.(pdf|csv|xlsx)$/i;
const optionalText = z.string().trim().max(200).optional().transform((value) => value || undefined);
const formSchema = z.object({
  asOf: ownershipMonthSchema,
  source: optionalText,
  snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
});

const fail = (error: string, status: number, message?: string) => NextResponse.json({ error, message: message ?? null }, { status, headers: { "cache-control": "no-store" } });

/** Behind the proxy the request URL is the container's; the public origin is the forwarded host or BETTER_AUTH_URL. */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const allowed = new Set([new URL(request.url).origin]);
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) allowed.add(`${request.headers.get("x-forwarded-proto") ?? "https"}://${forwardedHost}`);
  try { if (process.env.BETTER_AUTH_URL) allowed.add(new URL(process.env.BETTER_AUTH_URL).origin); } catch { /* unset or invalid: not allowed */ }
  return allowed.has(origin);
}

/** Admin-only; anyone else gets the same 404 as a missing route. */
async function guard(request: Request) {
  if (!(await isAdmin().catch(() => false))) return { response: fail("NOT_FOUND", 404) };
  // Same-origin requests only (the browser sends Origin on POST): a cross-site form can't trigger an upload.
  if (request.method === "POST" && !sameOrigin(request)) return { response: fail("FORBIDDEN", 403) };
  const engine = engineAdmin();
  if (!engine) return { response: fail("NOT_CONFIGURED", 503, "MARKET_API_URL and ENGINE_ADMIN_TOKEN must be set") };
  return { engine };
}

async function engineCall(engine: { baseUrl: string; token: string }, path: string, init: RequestInit = {}) {
  return fetch(`${engine.baseUrl}${path}`, { ...init, headers: { ...init.headers, authorization: `Bearer ${engine.token}` }, cache: "no-store", signal: AbortSignal.timeout(120_000) });
}

export async function GET(request: Request) {
  const checked = await guard(request);
  if (checked.response) return checked.response;
  try {
    const response = await engineCall(checked.engine, "/v1/admin/ownership/uploads?limit=20");
    if (!response.ok) return fail("ENGINE_ERROR", 502, `Engine returned ${response.status}`);
    const body = z.object({ data: z.array(ownershipUploadSchema) }).safeParse(await response.json().catch(() => null));
    if (!body.success) return fail("MALFORMED_RESPONSE", 502);
    return NextResponse.json({ data: body.data.data }, { headers: { "cache-control": "no-store" } });
  } catch {
    return fail("ENGINE_UNREACHABLE", 503);
  }
}

export async function POST(request: Request) {
  const checked = await guard(request);
  if (checked.response) return checked.response;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) return fail("INVALID_REQUEST", 400, "Choose a file");
  if (!FORMATS.test(file.name)) return fail("INVALID_REQUEST", 400, "Only PDF, CSV or XLSX files");
  if (file.size === 0 || file.size > MAX_BYTES) return fail("INVALID_REQUEST", 400, "The file is empty or larger than 20 MB");
  const fields = formSchema.safeParse({ asOf: form.get("asOf") ?? undefined, source: form.get("source") ?? undefined, snapshotDate: form.get("snapshotDate") ?? undefined });
  if (!fields.success) return fail("INVALID_REQUEST", 400, "asOf must be YYYY-MM; snapshotDate YYYY-MM-DD");

  const forward = new FormData();
  forward.set("file", file, file.name.split(/[\\/]/).pop()!.slice(0, 200));
  forward.set("asOf", fields.data.asOf);
  if (fields.data.source) forward.set("source", fields.data.source);
  if (fields.data.snapshotDate) forward.set("snapshotDate", fields.data.snapshotDate);
  try {
    const response = await engineCall(checked.engine, "/v1/admin/ownership/upload", { method: "POST", body: forward });
    const body = await response.json().catch(() => null) as { data?: unknown; duplicate?: boolean; error?: { code?: string; message?: string } } | null;
    if (!response.ok) {
      logWarn("ownership_upload_rejected", { status: response.status, code: body?.error?.code ?? null });
      return fail(body?.error?.code ?? "ENGINE_ERROR", response.status >= 500 ? 502 : response.status, body?.error?.message);
    }
    const upload = ownershipUploadSchema.safeParse(body?.data);
    if (!upload.success) return fail("MALFORMED_RESPONSE", 502);
    return NextResponse.json({ data: upload.data, duplicate: body?.duplicate === true }, { status: response.status, headers: { "cache-control": "no-store" } });
  } catch (error) {
    logError("ownership_upload_failed", { message: error instanceof Error ? error.message : String(error) });
    return fail("ENGINE_UNREACHABLE", 503);
  }
}
