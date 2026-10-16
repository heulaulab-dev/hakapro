// Admin ownership routes (E6, DATA-ENGINE.md §8.5d). Reached only after the ENGINE_ADMIN_TOKEN check in app.ts.
//   POST /v1/admin/ownership/upload?asOf=YYYY-MM[&source=…][&snapshotDate=YYYY-MM-DD][&filename=…]
//        body: multipart/form-data with a `file` field, or the raw file (application/pdf, text/csv, .xlsx)
//   GET  /v1/admin/ownership/uploads[?limit=]
//   POST /v1/admin/ownership/uploads/{id}/reparse
import { z } from "zod";
import { ownershipMonthSchema } from "@/server/schemas/ownership";
import type { Logger } from "../log";
import type { OwnershipService } from "../ownership/service";
import type { PauseGuard } from "../schedule/pause";
import { uploadView } from "../serve/ownership";

export type OwnershipDeps = {
  service: OwnershipService;
  /** Largest accepted file (ENGINE_OWNERSHIP_MAX_UPLOAD_MB). */
  maxUploadBytes: number;
  /** ENGINE_FREE_FLOAT_ENABLED: serve the HAKA-34 draft estimate on /v1/stocks/{s}/ownership. */
  freeFloatEnabled: boolean;
};

/** Multipart framing allowance on top of the file limit. */
const MULTIPART_OVERHEAD = 64 * 1024;
const UPLOAD_LIST_MAX = 200;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const error = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) => json({ error: { code, message }, ...extra }, status);

const uuidSchema = z.uuid();
const realDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const label = z.string().trim().min(1).max(200).regex(/^[^\u0000-\u001f\u007f]*$/, "no control characters");
/** A file name as a label only: no directories, at most 200 characters. */
const safeFileName = (name: string | null | undefined) => {
  const base = name?.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return base ? base.slice(0, 200) : null;
};

/** Reads at most `limit` bytes; null when the body is larger (the stream is cancelled, nothing more is read). */
async function readCapped(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

export async function ownershipAdmin(
  deps: OwnershipDeps, request: Request, url: URL, path: string, method: string, ctx: { pause: PauseGuard; now: Date; log: Logger },
): Promise<Response> {
  if (path === "/v1/admin/ownership/uploads") {
    if (method !== "GET" && method !== "HEAD") return error(405, "METHOD_NOT_ALLOWED", "Use GET");
    const limit = z.coerce.number().int().min(1).max(UPLOAD_LIST_MAX).safeParse(url.searchParams.get("limit") || 50);
    if (!limit.success) return error(400, "BAD_REQUEST", `limit must be 1–${UPLOAD_LIST_MAX}`);
    const uploads = await deps.service.store.listUploads(limit.data);
    return json({ data: uploads.map(uploadView) });
  }

  const reparse = path.match(/^\/v1\/admin\/ownership\/uploads\/([^/]+)\/reparse$/);
  if (reparse) {
    if (method !== "POST") return error(405, "METHOD_NOT_ALLOWED", "Use POST");
    const id = uuidSchema.safeParse(decodeURIComponent(reparse[1]));
    if (!id.success) return error(400, "BAD_REQUEST", "Invalid upload id");
    const upload = await deps.service.reparse(id.data);
    if (!upload) return error(404, "NOT_FOUND", "No such upload");
    ctx.log.warn("ownership_upload_reparsed", { upload: upload.id, status: upload.status });
    return upload.status === "PARSED" ? json({ data: uploadView(upload) }) : error(422, "PARSE_FAILED", upload.error ?? "Parsing failed", { data: uploadView(upload) });
  }

  if (path !== "/v1/admin/ownership/upload") return error(404, "NOT_FOUND", "Not found");
  if (method !== "POST") return error(405, "METHOD_NOT_ALLOWED", "Use POST");

  const pause = await ctx.pause.check();
  if (pause.diskPercent === null || pause.diskPercent > pause.diskStopPercent) {
    return error(503, "DISK_GUARD", `Uploads are refused while disk use is above ${pause.diskStopPercent}% (or unknown)`);
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  const multipart = contentType.startsWith("multipart/form-data");
  const body = await readCapped(request, deps.maxUploadBytes + (multipart ? MULTIPART_OVERHEAD : 0));
  const tooLarge = () => error(413, "PAYLOAD_TOO_LARGE", `The file is larger than ${Math.round(deps.maxUploadBytes / 1024 / 1024)} MB`);
  if (!body) return tooLarge();

  let bytes = body;
  let fileType: string | null = contentType.split(";")[0].trim() || null;
  let fileName = safeFileName(url.searchParams.get("filename"));
  const fields = new Map<string, string>();
  if (multipart) {
    const form = await new Response(body, { headers: { "content-type": request.headers.get("content-type")! } }).formData().catch(() => null);
    if (!form) return error(400, "BAD_REQUEST", "Unreadable multipart body");
    const file = form.get("file");
    if (!file || typeof file === "string") return error(400, "BAD_REQUEST", "Multipart upload needs a `file` field");
    bytes = new Uint8Array(await file.arrayBuffer());
    fileType = file.type || null;
    fileName = safeFileName(file.name) ?? fileName;
    for (const name of ["asOf", "source", "snapshotDate"]) {
      const value = form.get(name);
      if (typeof value === "string" && value) fields.set(name, value);
    }
  }
  if (bytes.byteLength === 0) return error(400, "BAD_REQUEST", "Empty upload");
  if (bytes.byteLength > deps.maxUploadBytes) return tooLarge();

  const read = (name: string) => url.searchParams.get(name) || fields.get(name) || undefined;
  const asOf = ownershipMonthSchema.safeParse(read("asOf"));
  if (!asOf.success) return error(400, "BAD_REQUEST", "asOf=YYYY-MM (the month of the list) is required");
  const currentMonth = new Date(ctx.now.getTime() + 7 * 3_600_000).toISOString().slice(0, 7); // WIB
  if (asOf.data > currentMonth) return error(400, "BAD_REQUEST", `asOf ${asOf.data} is in the future`);
  const sourceRaw = read("source");
  const source = sourceRaw === undefined ? null : label.safeParse(sourceRaw);
  if (source && !source.success) return error(400, "BAD_REQUEST", "source must be 1–200 printable characters");
  const snapshotDate = read("snapshotDate") ?? null;
  if (snapshotDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate) || !realDate(snapshotDate) || snapshotDate.slice(0, 7) !== asOf.data)) {
    return error(400, "BAD_REQUEST", "snapshotDate must be a YYYY-MM-DD date inside the asOf month");
  }

  const outcome = await deps.service.upload({
    bytes, contentType: fileType, fileName, asOfMonth: asOf.data, sourceLabel: source ? source.data! : null, snapshotDate,
  });
  switch (outcome.kind) {
    case "unsupported":
      return error(415, "UNSUPPORTED_MEDIA_TYPE", outcome.message);
    case "duplicate":
      return json({ data: uploadView(outcome.upload), duplicate: true });
    case "conflict":
      return error(409, "CONFLICT", outcome.message, { data: uploadView(outcome.upload) });
    case "created":
      if (outcome.upload.status === "PARSED") return json({ data: uploadView(outcome.upload) }, 201);
      return error(422, "PARSE_FAILED", outcome.upload.error ?? "Parsing failed", { data: uploadView(outcome.upload) });
  }
}
