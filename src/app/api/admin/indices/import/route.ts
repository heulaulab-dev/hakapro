import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { engineAdmin } from "@/server/admin";
import { logWarn } from "@/server/log";

export const runtime = "nodejs";

const MAX_BYTES = 4_000_000;
const requestSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  body: z.unknown(),
}).strict();
const resultSchema = z.object({
  data: z.object({ date: z.string(), received: z.number().int(), rejected: z.number().int(), stored: z.number().int() }),
});

function bearerMatches(header: string | null, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const fail = (code: string, status: number) =>
  NextResponse.json({ error: code }, { status, headers: { "cache-control": "no-store" } });

/** Public HTTPS gateway for one import-only operation; the engine remains on Coolify's private network. */
export async function POST(request: Request) {
  const engine = engineAdmin();
  if (!engine) return fail("NOT_CONFIGURED", 503);
  if (!bearerMatches(request.headers.get("authorization"), engine.token)) return fail("UNAUTHORIZED", 401);

  const declaredBytes = Number(request.headers.get("content-length") ?? 0);
  if (declaredBytes > MAX_BYTES) return fail("PAYLOAD_TOO_LARGE", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return fail("PAYLOAD_TOO_LARGE", 413);
  let input: unknown;
  try { input = JSON.parse(text); } catch { return fail("INVALID_JSON", 400); }
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return fail("INVALID_REQUEST", 400);
  const [year, month, day] = parsed.data.date.split("-").map(Number);
  const realDate = new Date(Date.UTC(year, month - 1, day));
  if (realDate.getUTCFullYear() !== year || realDate.getUTCMonth() !== month - 1 || realDate.getUTCDate() !== day) return fail("INVALID_DATE", 400);

  try {
    const response = await fetch(`${engine.baseUrl}/v1/admin/indices/import`, {
      method: "POST",
      headers: { authorization: `Bearer ${engine.token}`, "content-type": "application/json" },
      body: text,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      logWarn("idx_collector_proxy_rejected", { status: response.status, date: parsed.data.date });
      return NextResponse.json(body ?? { error: "ENGINE_ERROR" }, { status: response.status, headers: { "cache-control": "no-store" } });
    }
    const result = resultSchema.safeParse(body);
    if (!result.success) return fail("MALFORMED_ENGINE_RESPONSE", 502);
    return NextResponse.json(result.data, { status: response.status, headers: { "cache-control": "no-store" } });
  } catch {
    logWarn("idx_collector_proxy_unreachable", { date: parsed.data.date });
    return fail("ENGINE_UNREACHABLE", 503);
  }
}
